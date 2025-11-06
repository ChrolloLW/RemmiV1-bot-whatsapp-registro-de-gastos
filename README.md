# RemmiV1 — WhatsApp Expense Logger

> 🇺🇸 English instructions are below this Spanish section.

---

## 🇪🇸 ESPAÑOL — (principal)

RemmiV1 es un bot de WhatsApp (Meta Cloud API) que registra gastos en Google Sheets usando lenguaje natural.

Ejemplo de mensaje real que le envías por WhatsApp:

```
ramen comida 35 tarjeta
```

Interpretación automática:
| campo | valor |
|---|---|
| descripción | ramen |
| categoría | comida |
| monto | 35 |
| medio | tarjeta |

**Regla clave:**  
> La **palabra inmediatamente anterior al monto** es tomada como **categoría**.

---

## ✨ Funciones principales

- 📲 Registrar gasto directo en chat  
- 💳 Detección de medio de pago (yape, plin, tarjeta, transferencia, efectivo)  
- 🧠 Clasificación por keywords si la categoría no está explícita  
- 📅 Reportes: mensual / trimestral / semestral  
- 📄 Exportar CSV por periodo  
- 🗂️ Gestionar categorías (listar, crear, añadir keywords)  
- 💬 Mensajes de ayuda: **hola**, **ayuda**, **?**

---

## 📊 Estructura en Google Sheets

### Hoja: `remmiV1`
```
timestamp | categoría | descripción | medioPago | monto
```

### Hoja: `categorias`
```
categoria | keywords
```

Ejemplo:
```
comida | pollo, pizza, ramen
```

---

## 🔐 Script Properties necesarias (en Apps Script)

Apps Script → Project Settings → Script Properties

| KEY | DESCRIPCIÓN |
|---|---|
| META_VERIFY_TOKEN | token de verificación webhook |
| META_PHONE_NUMBER_ID | ID numérico del número WA Cloud |
| META_ACCESS_TOKEN | access token **permanente** |

> ⚠️ **No subas estos valores a GitHub** (mantener en Script Properties)

---

## 🚀 Configurar Webhook (Apps Script)

1. Deploy → New deployment → **Web app**
2. Execute as: **Me**
3. Who has access: **Anyone**
4. Copiar URL → pegar en configuración de Webhook de Meta Cloud API

---

## ☁️ Configuración resumida en Meta Cloud API

1. Obtener **Phone Number ID**  
2. Crear **Access Token permanente**  
3. Agregar tu número en **Test numbers**  
4. Webhook → Callback URL = URL de Apps Script  

---

## 💡 Comandos útiles vía WhatsApp

```
hola | ayuda | ?
listar categorias
agregar categoria: <nombre> | kw1, kw2
reporte
reporte octubre
reporte q2 2025
reporte semestre 2025
copia octubre
```

---

## 🧩 Troubleshooting rápido

| Caso | Solución |
|---|---|
| El bot no responde | Web app debe ser "Anyone" + webhook verificado |
| Error 400 | PHONE_NUMBER_ID sin + ni paréntesis, número debe estar en Test Numbers |
| Reporte vacío | No hay datos para ese periodo |

---

Apps Script + Meta Cloud API + Google Sheets

---

## 🇺🇸 ENGLISH — (secondary, reference)

RemmiV1 is a WhatsApp bot (Meta Cloud API) that writes your expenses into Google Sheets from natural text.

Example message you send on WhatsApp:

```
ramen comida 35 tarjeta
```

Meaning:
| field | value |
|---|---|
| description | ramen |
| category | comida |
| amount | 35 |
| payment | tarjeta |

**Key rule:**  
> The **word right before the number** is considered the **category**.

---

### ✨ Core Features

- 📲 Register expense from natural language  
- 💳 Payment detect: yape, plin, tarjeta, transferencia, efectivo  
- 🧠 Heuristics if no explicit category  
- 📅 Monthly / Quarter / Semester reports  
- 📄 CSV export  
- 🗂️ Category management  

---

### 📊 Sheets required

**remmiV1**
```
timestamp | categoria | descripcion | medioPago | monto
```

**categorias**
```
categoria | keywords
```

---

### 🔐 Script Properties (DO NOT COMMIT)

```
META_VERIFY_TOKEN
META_PHONE_NUMBER_ID
META_ACCESS_TOKEN
```

---

### 🚀 Webhook deploy

Apps Script → Deploy as Web App → Anyone  
Copy URL → set in Meta webhook

---

### 💬 Commands

```
hola | ayuda | ?
listar categorias
agregar categoria: name | kw1, kw2
reporte
reporte october
reporte q2 2025
reporte semester 2025
copia october
```

---

### 🧩 Troubleshooting

| Issue | Fix |
|---|---|
| bot not responding | publish as Web app → Anyone + webhook verified |
| 400 error | PHONE_NUMBER_ID must be digits only; number must be test-number |
| empty report | no data for requested period |

---
Autor: Manuel Cardenas M
### 👨‍💻 Author
**Manuel Cárdenas Moza**
