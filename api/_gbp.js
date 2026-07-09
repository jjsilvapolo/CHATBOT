// Google Business Profile client — reads reviews and posts replies.
//
// No SDK: we hit the OAuth2 token endpoint and the v4 reviews API with fetch
// (same style as the Resend/Anthropic calls elsewhere in this repo).
//
// Reviews live in the legacy v4 API (mybusiness.googleapis.com/v4). Location
// discovery and account listing moved to the newer split APIs, but replies +
// review listing are still v4. We only need v4 here.
//
// Required env (see .env.example). If any is missing, isConfigured() is false
// and the cron/endpoint degrade gracefully to "not_configured" instead of
// throwing — so deploying this code before Google approves access is inert.
//
//   GBP_CLIENT_ID       OAuth client id (Google Cloud → Credentials)
//   GBP_CLIENT_SECRET   OAuth client secret
//   GBP_REFRESH_TOKEN   long-lived refresh token for the account that manages BJ
//   GBP_LOCATIONS       JSON map { "<accountId>/<locationId>": "Chamberí", ... }
//                       BJ's locations live under TWO accounts (the personal one
//                       holds Majadahonda; the LOCATION_GROUP holds the rest), so
//                       each key carries its own account id. Plain locationId keys
//                       fall back to GBP_ACCOUNT_ID (legacy single-account form).
//   GBP_ACCOUNT_ID      (optional) fallback account for legacy plain keys.
//
// Scope used to obtain the refresh token: https://www.googleapis.com/auth/business.manage

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const V4_BASE = "https://mybusiness.googleapis.com/v4";

function isConfigured() {
  return !!(process.env.GBP_CLIENT_ID && process.env.GBP_CLIENT_SECRET &&
            process.env.GBP_REFRESH_TOKEN && getLocations().length > 0);
}

// Parse the GBP_LOCATIONS map: { "accountId/locationId": "Human label" }.
// Entries without an account prefix use GBP_ACCOUNT_ID; if neither resolves an
// account the entry is dropped (better to skip a locale than to 404 every run).
function getLocations() {
  try {
    var m = JSON.parse(process.env.GBP_LOCATIONS || "{}");
    return Object.keys(m).map(function (key) {
      var parts = key.split("/");
      var account = parts.length === 2 ? parts[0] : (process.env.GBP_ACCOUNT_ID || null);
      var id = parts.length === 2 ? parts[1] : key;
      return { account: account, id: id, name: m[key] };
    }).filter(function (l) { return !!l.account; });
  } catch (e) { return []; }
}

// Cache the access token in-module for its lifetime (~1h) to avoid a token
// exchange on every call within a warm serverless instance.
let _token = null;
let _tokenExpiry = 0;

async function getAccessToken() {
  var nowMs = Date.now();
  if (_token && nowMs < _tokenExpiry - 60000) return _token;

  var body = new URLSearchParams({
    client_id: process.env.GBP_CLIENT_ID,
    client_secret: process.env.GBP_CLIENT_SECRET,
    refresh_token: process.env.GBP_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });
  var res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    var t = await res.text().catch(function () { return ""; });
    throw new Error("GBP token error " + res.status + ": " + t.slice(0, 300));
  }
  var json = await res.json();
  _token = json.access_token;
  _tokenExpiry = nowMs + ((json.expires_in || 3600) * 1000);
  return _token;
}

// List reviews for one location. Returns the raw v4 review objects.
// GBP paginates; we pull up to `maxPages` (each up to 50) — plenty for a daily
// cron since we only care about recent, still-unanswered reviews.
// `loc` is an entry from getLocations() ({account, id, name}).
async function listReviews(loc, maxPages) {
  var token = await getAccessToken();
  var parent = "accounts/" + loc.account + "/locations/" + loc.id;
  var reviews = [];
  var pageToken = null;
  var pages = 0;
  do {
    var url = V4_BASE + "/" + parent + "/reviews?orderBy=updateTime desc&pageSize=50" +
      (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
    var res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (!res.ok) {
      var t = await res.text().catch(function () { return ""; });
      throw new Error("GBP reviews " + res.status + " (" + loc.name + " " + loc.id + "): " + t.slice(0, 300));
    }
    var json = await res.json();
    if (json.reviews) reviews = reviews.concat(json.reviews);
    pageToken = json.nextPageToken || null;
    pages++;
  } while (pageToken && pages < (maxPages || 3));
  return reviews;
}

// Post (or overwrite) the reply to a review. `reviewName` is the full resource
// name Google returns (accounts/.../locations/.../reviews/<id>).
async function replyToReview(reviewName, comment) {
  var token = await getAccessToken();
  var url = V4_BASE + "/" + reviewName + "/reply";
  var res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ comment: comment }),
  });
  if (!res.ok) {
    var t = await res.text().catch(function () { return ""; });
    throw new Error("GBP reply " + res.status + ": " + t.slice(0, 300));
  }
  return await res.json();
}

// Map Google's star enum to a number.
const STAR_MAP = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
function starToNumber(starRating) {
  return STAR_MAP[starRating] || 0;
}

// Como listReviews pero devolviendo tambien los agregados que Google incluye en la primera
// pagina: totalReviewCount y averageRating (all-time, por ficha) — base del sentimiento por tienda.
async function listReviewsMeta(loc, maxPages) {
  var token = await getAccessToken();
  var parent = "accounts/" + loc.account + "/locations/" + loc.id;
  var reviews = [], pageToken = null, pages = 0, total = null, avg = null;
  do {
    var url = V4_BASE + "/" + parent + "/reviews?orderBy=updateTime desc&pageSize=50" +
      (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
    var res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (!res.ok) {
      var t = await res.text().catch(function () { return ""; });
      throw new Error("GBP reviews " + res.status + " (" + loc.name + "): " + t.slice(0, 300));
    }
    var json = await res.json();
    if (total == null && json.totalReviewCount != null) total = json.totalReviewCount;
    if (avg == null && json.averageRating != null) avg = json.averageRating;
    if (json.reviews) reviews = reviews.concat(json.reviews);
    pageToken = json.nextPageToken || null;
    pages++;
  } while (pageToken && pages < (maxPages || 3));
  return { reviews: reviews, totalReviewCount: total, averageRating: avg };
}

module.exports = { isConfigured, getLocations, getAccessToken, listReviews, listReviewsMeta, replyToReview, starToNumber };
