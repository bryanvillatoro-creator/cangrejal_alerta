# Cómo conectar Cangrejal Alerta a Firebase

Tu sitio sigue viviendo en GitHub (Pages o cualquier hosting estático). Firebase
solo se usa como backend: login/registro (Authentication) y base de datos
compartida en tiempo real (Firestore). No hace falta usar Firebase Hosting.

## 1. Crear el proyecto (gratis, plan Spark)
1. Ve a https://console.firebase.google.com → **Crear proyecto**.
2. Dale un nombre (ej. `cangrejal-alerta`) y termina el asistente.

## 2. Registrar la app web
1. En el proyecto: ⚙️ **Configuración del proyecto** → pestaña **Tus apps** → ícono `</>`.
2. Ponle un nombre y registra la app (no necesitas Firebase Hosting).
3. Copia el objeto `firebaseConfig` que te muestra y pégalo en `firebase-config.js`,
   reemplazando los valores `"TU_API_KEY"`, etc.

> Esa `apiKey` **no es secreta** — está pensada para ir en el código del cliente.
> La seguridad real la dan las reglas de Firestore del paso 4.

## 3. Activar Authentication
1. En el menú lateral: **Authentication** → **Sign-in method**.
2. Habilita el proveedor **Correo/contraseña**.

## 4. Crear la base de datos Firestore
1. Menú lateral: **Firestore Database** → **Crear base de datos** → modo producción,
   elige la región más cercana (ej. `us-central` o `southamerica-east1`).
2. Ve a la pestaña **Reglas** y reemplaza todo el contenido por esto:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() {
      return request.auth != null;
    }
    function myProfile() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
    }
    function isApproved() {
      return isSignedIn() && myProfile().status in ['approved', 'admin'];
    }
    function isAdmin() {
      return isSignedIn() && myProfile().status == 'admin';
    }

    match /users/{userId} {
      // cualquiera puede crear su propio perfil al registrarse, siempre como "pending"
      allow create: if isSignedIn()
                    && request.auth.uid == userId
                    && request.resource.data.status == 'pending';
      // cada quien puede leer su propio perfil; el admin puede leer todos
      allow read: if isSignedIn() && (request.auth.uid == userId || isAdmin());
      // solo el admin puede aprobar/rechazar (cambiar status) o borrar
      allow update, delete: if isAdmin();
    }

    match /reports/{reportId} {
      allow read, create, update: if isApproved();
      allow delete: if isAdmin();
    }

    match /scores/{userName} {
      allow read: if isApproved();
      allow write: if isApproved();
    }
  }
}
```

3. Publica las reglas.

## 4b. Activar Firebase Storage (para fotos y videos)
1. Menú lateral: **Storage** → **Comenzar** → sigue el asistente (modo producción,
   misma región que Firestore si te lo pide).
2. Ve a la pestaña **Reglas** de Storage y reemplaza el contenido por lo que
   está en `storage.rules`:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /reports/{userId}/{fileName} {

      function isApprovedUser() {
        return request.auth != null &&
          firestore.get(/databases/(default)/documents/users/$(request.auth.uid)).data.status in ['approved', 'admin'];
      }

      allow read: if isApprovedUser();

      allow write: if isApprovedUser()
                   && request.auth.uid == userId
                   && request.resource.size < 25 * 1024 * 1024
                   && (request.resource.contentType.matches('image/.*') || request.resource.contentType.matches('video/.*'));
    }
  }
}
```

3. Publica. Esto solo deja subir/leer fotos y videos a cuentas aprobadas, y
   limita cada archivo a 25 MB.

> **Por qué Storage y no Firestore para las fotos/videos:** cada documento
> de Firestore tiene un límite de 1 MB. Un video de 15 segundos no cabe ahí,
> así que las fotos y videos ahora se guardan como archivos reales en
> Storage, y el reporte en Firestore solo guarda el enlace (`media.url`).

## 5. Crear tu primer usuario administrador
Las reglas de arriba no permiten que nadie se auto-asigne `admin` (por seguridad).
Para crear el primero:

1. Abre el sitio y **regístrate normalmente** con tu cuenta (quedará en `pending`).
2. En Firebase Console → **Firestore Database** → colección `users` → busca el
   documento con tu `uid` (verás tu nombre/correo).
3. Edita el campo `status` manualmente y cámbialo de `pending` a `admin`.
4. Recarga el sitio: ya verás el enlace **"Panel admin"** en la barra superior,
   desde donde podrás aprobar a las demás personas sin tocar la consola de nuevo.

## 6. Publicar en GitHub
Sube todos los archivos (`index.html`, `admin.html`, `script.js`, `auth.js`,
`firebase-config.js`, `style.css`) al mismo repositorio de siempre. Como todo
corre en el navegador del usuario, GitHub Pages funciona sin cambios.

## Notas y límites del plan gratuito
- **Firestore (Spark)**: 50,000 lecturas y 20,000 escrituras gratis por día —
  de sobra para una comunidad de un valle. Si el sitio crece mucho, Firebase
  te avisa antes de cobrar nada (no hay cobro automático sin activar
  facturación).
- **Storage (Spark)**: 5 GB de almacenamiento y 1 GB de descarga gratis por
  día. Las fotos se comprimen antes de subirse (máx. ~1000px, calidad 72%);
  los videos se suben tal cual, limitados a 15 segundos y 25 MB por archivo.
- Si alguna cuenta hace mal uso del sitio, el admin puede volver su `status`
  a algo distinto de `approved`/`admin` para bloquearla, sin borrar su cuenta.

## Siguiente fase sugerida: reportes offline
Ahora mismo, si no hay conexión a internet, el formulario no puede publicar
(sí se puede tomar la foto o grabar el video con la cámara, pero falta
conexión para subirlos). El propio requerimiento ya lo marca como mejora
futura: guardar el reporte y su evidencia en el dispositivo (por ejemplo,
con IndexedDB) y reenviarlo automáticamente en cuanto vuelva la señal, usando
un Service Worker con Background Sync. Es un cambio de arquitectura más
grande — avísame cuando quieran abordarlo y lo planificamos aparte.
