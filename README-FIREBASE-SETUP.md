# Aurea — Guía de configuración Firebase y seguridad

Esta app está preparada para funcionar en dos modos:

- Modo demo/local: usa `localStorage` y PIN 1234
- Modo producción: usa Firebase Auth + Firestore

La app ya quedó publicada en Hosting, pero para que funcione correctamente con usuarios reales y datos privados, es necesario completar la configuración de Firebase y las reglas de seguridad.

---

## Facturacion USA: facturas y versiones

- En un proyecto United States, **Facturacion > Nueva Factura** permite crear varias facturas independientes.
- **Ver / Editar > Guardar** conserva una copia de la version anterior (cliente, items, precios, total, estado, fechas y notas). Guardar sin cambios no crea otra version.
- **Invoice Date** es editable en facturas nuevas y existentes. Cada factura nueva o modificacion recibe un numero propio `AAMMDD-NNN`, con la fecha elegida y un contador diario compartido con presupuestos. Varias facturas de la misma fecha tienen correlativos diferentes. Se evitan tambien los numeros existentes en presupuestos, facturas antiguas y versiones historicas. No se reutiliza el numero del presupuesto. La fecha real de guardado se conserva por separado en el historial.
- Las versiones se consultan en la propia factura y en **Historial** del proyecto; cada una tiene vista previa y PDF con sus datos y numero originales.
- El monto del proyecto es la suma de las facturas vigentes, sin sumar las versiones anteriores. Para estos proyectos USA, la ganancia prevista se calcula con ese monto menos los gastos. Esto no registra cobros ni modifica los ingresos o el presupuesto original; las otras administraciones conservan su calculo habitual.
- Una vez sincronizado desde facturas, editar el presupuesto no reemplaza ese monto. Eliminar una factura tambien elimina sus versiones y descuenta su total, previa confirmacion.
- En Firebase, la factura y el monto del proyecto se guardan juntos en una transaccion. Una edicion concurrente se rechaza para evitar sobrescribir otra version; hay que volver a abrir la factura.
- Las facturas anteriores a esta funcionalidad comienzan como version 1. Su primera modificacion conserva la informacion existente; no se pueden reconstruir cambios que nunca se guardaron.

Pruebas de regresion: `node --test scripts/invoice.test.js` (adaptador local, modo demo de Firebase y transacciones Firebase simuladas, sin acceder a datos reales).

## 1) Requisitos previos

Necesitás tener:

- Una cuenta de Google
- Un proyecto en Firebase
- Firebase CLI instalado
- El proyecto de la app conectado al proyecto Firebase correcto

### Instalar Firebase CLI

```bash
npm install -g firebase-tools
```

Verificá que esté instalado:

```bash
firebase --version
```

---

## 2) Iniciar sesión en Firebase CLI

```bash
firebase login
```

Si querés confirmar el proyecto activo:

```bash
firebase use
```

Y si querés dejarlo explícito:

```bash
firebase use aurea-international-management
```

---

## 3) Verificar que el proyecto tenga permisos correctos

El error más común es este:

```text
403 The caller does not have permission
```

Esto significa que la cuenta logueada en Firebase CLI no tiene permisos suficientes para administrar Firestore del proyecto.

### Debe tener alguno de estos roles:

- Owner
- Editor
- Firebase Admin

En Firebase Console:

1. Abrir proyecto
2. Ir a Configuración del proyecto
3. Entrar a Usuarios y permisos
4. Verificar que tu cuenta está como propietario o editor

Si no lo está, pedí que te agreguen.

---

## 4) Crear Firestore Database

En Firebase Console:

1. Ir a Firestore Database
2. Click en “Crear base de datos”
3. Elegir configuración de seguridad
4. Seleccionar “Comenzar en modo prueba” o “Producción” según corresponda
5. Elegir la ubicación del servidor

> Importante: si no existe la base de datos, el comando `firebase deploy --only firestore` no puede crearla con permisos insuficientes.

---

## 5) Reglas de seguridad recomendadas

Archivo: `firestore.rules`

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

### Qué hacen estas reglas

- Cada usuario solo puede acceder a sus propios datos
- La ruta `users/{uid}/...` está protegida por el UID autenticado
- Todo lo que no esté bajo `users/{uid}` queda bloqueado

Esto es clave para que los usuarios no puedan ver información de otros clientes o empresas.

---

## 6) Archivo `firestore.indexes.json`

Archivo: `firestore.indexes.json`

```json
{
  "indexes": [],
  "fieldOverrides": []
}
```

Este archivo es válido para empezar. Si más adelante agregás consultas complejas con `where`, `orderBy`, `limit`, podrías necesitar índices adicionales.

---

## 7) Configuración de Hosting

Archivo: `firebase.json`

```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "hosting": {
    "public": ".",
    "ignore": [
      "firebase.json",
      "**/.*",
      "**/node_modules/**"
    ],
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ]
  }
}
```

### Importante

- `public: "."` apunta a la raíz del proyecto, que es donde está la app real
- Esto evita que Firebase sirva la plantilla por defecto de Hosting
- El rewrite a `index.html` permite SPA routing

---

## 8) Configuración de Firebase en la app

Archivo: `firebase-config.js`

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyDROFsVQYi-UDEKQJKxakT-2oJZdFpBrTw",
  authDomain: "aurea-international-management.firebaseapp.com",
  projectId: "aurea-international-management",
  storageBucket: "aurea-international-management.firebasestorage.app",
  messagingSenderId: "708315838479",
  appId: "1:708315838479:web:f849b84c4458bab5064b7a"
};
```

Esto ya está conectado al proyecto correcto. Lo que faltaría es:

- que Firebase Auth esté habilitado
- que Firestore esté creado
- que la cuenta que usa el CLI tenga permisos

---

## 9) Habilitar Firebase Auth

En Firebase Console:

1. Ir a Authentication
2. Click en “Comenzar”
3. Habilitar Email/Password
4. Si la app usa PIN + email solamente, lo ideal es crear usuarios con email/contraseña y luego manejar el flujo con PIN dentro de la app

### Importante en esta app

La lógica de `auth.js` usa:

- registro con email + PIN
- login con PIN
- almacenamiento del usuario autenticado
- `localStorage` para recordar el email registrado

En Firebase real, esto debería ir acompañado de un flujo de autenticación consistente, porque el PIN no es el mecanismo oficial de Firebase. La app usa un PIN propio para una capa extra de seguridad.

---

## 9.1) Cómo habilitar el ingreso por PIN en la app

La app ya está preparada para que el ingreso principal pueda hacerse con un PIN, además del email del usuario.

### Flujo recomendado

1. El usuario se registra con:
   - email
   - PIN numérico (4 a 6 dígitos)
2. El sistema hashea el PIN con SHA-256
3. El hash se guarda en Firestore asociado al UID del usuario
4. Al hacer login, el sistema:
   - toma el PIN ingresado
   - lo hashea
   - lo compara con el hash guardado
   - si coincide, deja pasar al usuario

### Validaciones que debe cumplir el PIN

- solo números
- longitud entre 4 y 6 dígitos
- no aceptar texto ni espacios
- no guardar el PIN en texto plano

### En la práctica

La lógica está en `auth.js` y usa funciones como:

- `register(email, pin)`
- `loginWithPIN(pin)`
- `loginWithEmail(email, pin)`
- `changePIN(newPIN)`
- `hashPIN(pin)`

### Recomendación para producción

Para la versión real en Firebase, te conviene seguir este esquema:

- Firebase Auth maneja la identidad real del usuario con email/password
- `auth.js` usa un PIN extra para acceso rápido y más seguridad operativa
- Firestore guarda el `pinHash` por usuario

Esto mantiene la app cómoda para el usuario y segura para la base de datos.

### Ejemplo de uso en la app

```javascript
const user = await Auth.register('usuario@empresa.com', '1234');
const logged = await Auth.loginWithPIN('1234');
```

### Recomendación importante

No uses el PIN como la única autenticación oficial de Firebase. El sistema oficial es Firebase Auth; el PIN debería ser una segunda capa o una capa de acceso rápida interna a la app.

---

## 10) Estructura de datos recomendada

La lógica actual de Firestore usa este patrón:

```text
users/
  {uid}/
    budgets/
    projects/
    incomes/
    expenses/
    operations/
    invoices/
    config/
    counters/
```

Esto está bien y cumple con la idea de aislar datos por usuario.

---

## 11) Flujo recomendado para operar la app en producción

### Paso 1: Crear el proyecto Firebase

- Crear proyecto nuevo o usar el actual
- Verificar `projectId`

### Paso 2: Habilitar Auth y Firestore

- Auth: Email/Password
- Firestore: base creada

### Paso 3: Conectar la app

- Revisar `firebase-config.js`
- Confirmar `projectId` y `apiKey`

### Paso 4: Publicar Hosting

```bash
firebase deploy --only hosting
```

### Paso 5: Publicar reglas y Firestore

```bash
firebase deploy --only firestore
```

O ambos a la vez:

```bash
firebase deploy --only hosting,firestore
```

---

## 12) Comandos útiles

### Login

```bash
firebase login
```

### Verificar proyecto activo

```bash
firebase use
```

### Deploy general

```bash
firebase deploy
```

### Deploy solo hosting

```bash
firebase deploy --only hosting
```

### Deploy solo Firestore

```bash
firebase deploy --only firestore
```

### Ver logs de hosting

```bash
firebase hosting:channel:list
```

### Ver logs del proyecto

```bash
firebase projects:list
```

---

## 13) Qué revisar antes de darla por lista

Hay que corroborar esto:

- [ ] Firebase Auth habilitado
- [ ] Firestore creado
- [ ] Cuenta de CLI con permisos correctos
- [ ] `firebase.json` apuntando a la raíz del proyecto
- [ ] `firestore.rules` cargadas
- [ ] `firestore.indexes.json` presente
- [ ] `firebase-config.js` con el proyecto correcto
- [ ] Login funcional en producción
- [ ] Datos privados aislados por usuario

---

## 14) Problema actual identificado

El error real que apareció fue:

```text
HTTP Error: 403, The caller does not have permission
```

Esto no es un problema de código de la app: es un problema de permisos de la cuenta de Firebase.

Entonces, antes de seguir con pruebas de la app en producción, lo principal es:

1. Verificar permisos del usuario en Firebase Console
2. Crear la base de Firestore
3. Volver a deployar

---

## 15) Recomendación final

La app está bien encaminada para producción, pero para que funcione de forma segura y estable, hace falta que la cuenta con acceso a Firebase sea la correcta y que Firestore esté habilitado.

Una vez que eso esté corregido, la siguiente validación debería ser:

- iniciar sesión real
- crear presupuesto
- crear proyecto
- guardar datos
- verificar que cada usuario ve solo su data

---

## 16) Comandos de deploy final esperados

Una vez resueltos los permisos, correr esto:

```bash
firebase login
firebase use aurea-international-management
firebase deploy --only hosting,firestore
```

Y luego comprobar la app publicando en:

```text
https://aurea-international-management.web.app
```

---

Si querés, te dejo también una segunda versión de este documento más corta y más “operativa”, pensada para que la copies directamente en tu proyecto como guía de mantenimiento.
