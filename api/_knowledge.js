// Shared knowledge summary for sync verification.
// Keep in sync with the full SYSTEM_PROMPT in chat.js.
// sync.js uses this to detect changes on burgerjazz.com.

const CURRENT_KNOWLEDGE = `BURGERS: BASIC JAZZ 9,95€ | BURGER JAZZ 13,95€ | ROYAL JAZZ 13,95€ | OLD JAZZ 14,95€ | BLUE JAZZ 13,95€ | MONTERREY JAZZ 14,95€ | BACON CHEESE JAZZ 13,95€
COMBOS: COMBO JAZZ SOLO 13,95€ | MENU DIA 14,90€
PATATAS: Basic 3,90€ | Spicy 3,90€ | Bacon Cheese 5,90€ | Truffle 5,90€
SALSAS: Ketchup, Mostaza, Cheddar Jalapeno, BBQ, Truffle Mayo, Salsa BJ (1,50€, Truffle Mayo 1,90€)
BATIDOS: Chocolate Belga, Galleta Maria, Vainilla Madagascar (5,90€)
POSTRES: Nutella Candy Jazz, Pistachio Candy Jazz (4,90€)
EXTRAS: +Carne 2,90€ | +Bacon 1€ | +Queso 1€ | +Jalapeno 0,50€
LOCALES: Chamberi, Plaza Espana, Retiro, Delicias, Alcorcon, Majadahonda, Pozuelo, Mirasierra, Alcobendas, Valladolid, Moraleja Green
CERRADOS: Malasana
DELIVERY PROPIO: pedidos.burgerjazz.com — Chamberi, Retiro, Delicias, Plaza Espana, Mirasierra (min 25€, envio 2,99€, radio 3km)
SIN GLUTEN: Chamberi (Basic Jazz, Burger Jazz, Royal Jazz sin gluten)
HORARIOS:
- Plaza Espana (Fomento): L-J 12:30-16:00 y 19:30-0:00 | V-D 12:30-0:00
- Delicias: L-M CERRADO | X-J 12:30-16:00 y 19:30-23:30 | V-D 12:30-0:00
- Chamberi (Modesto Lafuente): L-J 12:30-16:00 y 19:30-23:30 | V-D 12:30-16:30 y 19:30-0:00
- Retiro (O'Donnell): L-M CERRADO | X-J 12:30-16:00 y 19:30-23:30 | V-D 12:30-16:30 y 19:30-0:00
- Pozuelo: L-M CERRADO | X-J 12:30-16:00 y 19:30-23:30 | V-D 12:30-16:30 y 19:30-0:00
- Majadahonda: L-J 12:30-16:00 y 19:30-23:30 | V-D 12:30-16:30 y 19:30-0:00
- Alcorcon: L-M CERRADO | X-D 12:30-16:00 y 19:30-23:30
- Mirasierra (Fermin Caballero): L-M CERRADO | X-J 12:30-16:00 y 19:30-23:30 | V-D 12:30-16:30 y 19:30-0:00
- Alcobendas: L-M CERRADO | X-J 12:30-16:00 y 19:30-23:00 | V-D 12:30-16:30 y 19:30-23:30
- Valladolid: L-M 12:30-16:00 (solo comida) | X-J 12:30-16:00 y 19:30-23:30 | V-D 12:30-16:30 y 19:30-23:30`;

module.exports = { CURRENT_KNOWLEDGE };
