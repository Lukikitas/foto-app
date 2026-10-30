# Roadmap: captura confiable y Android

Objetivo: capturar ticket y bolsa sin degradación progresiva en gama media/baja, conservar cada captura confirmada y recuperar envíos sin intervención. Android para captura/subidas; web para gestión. Dispositivo piloto: Moto G15. Inicio: 29/10/2026.

## Estado

| Etapa | Estado | Evidencia / salida |
| --- | --- | --- |
| 1. Auditar cámara, cola y herramientas | Completada | Código inspeccionado; SDK/JDK y emulador disponibles. Sin teléfono físico conectado en la inspección inicial. |
| 2. Proteger capturas y recuperación web | Implementada; validación en curso | Borradores en IndexedDB, recuperación por ID estable, tiempo máximo que incluye cuerpo de respuesta, reintentos y confirmación de evidencia antes del ticket, diagnóstico acotado. |
| 3. Confirmación idempotente en backend | Activada y verificada | Respaldo de 9579 registros; migración aditiva aplicada. `capture-sync` y corrección de tickets en `order-code-recovery` desplegados. Comprobadas lectura del esquema, validación, rechazo sin evidencia y denegación del RPC directo anónimo. |
| 4. Aplicación Android nativa | Implementada; validación en curso | Kotlin/Compose, CameraX, archivos privados, Room, WorkManager y ML Kit incluido; reglas de códigos compartidas en el backend. |
| 5. Compilación, pruebas e instalación piloto | Emulador aprobado; piloto físico pendiente | APK release firmado y verificado, instalación y arranque real con cámara aprobados. Cinco pruebas JVM y lint aprobados; cuatro pruebas instrumentadas aprobadas, incluida captura ticket/bolsa. Cierre completo del proceso y recuperación de ticket incompleto comprobados. |
| 6. Prueba física y turno completo | Pendiente | 500 pares/2 h y turno completo en Moto G15: integridad, memoria, tiempos, bloqueo, red y reinicio. |

## Criterios de aceptación

- La confirmación de guardado exige archivo persistido y estado recuperable; recuperar también el ticket de un par incompleto.
- Una tarea con error o lectura pendiente no detiene el resto de capturas/envíos.
- Reintentos y respuestas perdidas no crean duplicados ni eliminan evidencia remota confirmada.
- Pendientes sobreviven a cierre/reinicio. Android puede diferir trabajo por ahorro de batería; un cierre forzado requiere volver a abrir la aplicación.
- Sin pérdida de capturas confirmadas, sin duplicados y sin degradación progresiva durante las pruebas físicas. Compilar o aprobar pruebas sintéticas no demuestra estos criterios físicos.
- Respetar metadatos, reglas de identificación, correcciones manuales y retención actuales. Las claves privadas permanecen en el servidor.

## Registro de avance

- 29/10/2026: ejecución iniciada. Se inspeccionó el árbol real; los archivos no versionados preexistentes en `output/`, `.codex-remote-attachments/` y pruebas de ajustes se conservan. `android-camera/` solo contiene un informe antiguo de build; no hay una aplicación fuente que reutilizar.
- 29/10/2026: primera ejecución web: 432 pruebas aprobadas y build de producción aprobado. La compilación mantiene el aviso previo de `import.meta` en el service worker. Se agregó posteriormente otra prueba de reanudación del ticket sin repetir la evidencia; ampliar validación con ella.
- 29/10/2026: base aislada: migración de registro aplicada dos veces y pruebas nuevas aprobadas junto con las pruebas existentes. Emulador iniciado con 1536 MB; aún no sustituye la prueba del Moto G15. Se solicitó conexión del equipo físico mientras continúa el trabajo independiente.
- 29/10/2026: respaldo previo de metadatos en `output/capture-backend-20261029.local/before.json.gz` (no incluye binarios de Storage). Activadas migración y funciones; cinco comprobaciones de backend aprobadas sin crear pedidos sintéticos. Tipos de ambas funciones aprobados con Deno.
- 29/10/2026: primera prueba de persistencia Android en el emulador: 500 pares con hashes de archivos y confirmaciones preservados al reabrir Room; prueba de Repetir aprobada. La primera revisión visual detectó un ANR de **System UI del emulador** durante presión de memoria de compilación; esa sesión no sirve como medición de rendimiento del celular ni se declara aprobada. Se redujo el paralelismo de build y se separan las pruebas de cámara de la compilación.
- 29/10/2026: revisión de concurrencia: reclamación atómica de pares Android para impedir enviar una foto que el usuario acaba de repetir; límite de tiempo para captura y OCR; fuentes LiveData estables para evitar consultas/recomposiciones repetidas.
- 29/10/2026: cuatro pruebas instrumentadas aprobadas en emulador: cámara con guardado ticket/bolsa sin esperar red; 500 pares preservados al reabrir Room; exclusión mutua entre Repetir y envío; poda limitada a historia confirmada. La búsqueda de accesibilidad del test se corrigió para recorrer los nodos virtuales de Compose.
- 29/10/2026: `validate-android-restart.mjs` confirmó ticket guardado, cierre completo del proceso, recuperación del ticket y finalización con una bolsa nueva. Evidencias en `output/android-camera-20261029.local/`. Muestra puntual tras dos pares: PSS 96313 KiB y RSS 227040 KiB; **no** es un pico ni una medición de jornada ni del Moto G15.
- 29/10/2026: APK release instalado y arrancado con cámara en el emulador; firma y alineación de 16 KiB verificadas. Se sustituyó únicamente el prototipo propio del emulador, después de comprobar que no tenía capturas. Las pruebas debug usan otro identificador y un servidor inválido para no insertar pedidos de prueba en producción.
- 29/10/2026: regresiones web adicionales: reenvío de captura anterior a `capture_id` sin duplicar, respuesta de inserción perdida sin borrar evidencia, y 250 clientes de subida sin agregar listeners permanentes. El historial local Android se limita a 200 pares enviados y la red comparte un solo cliente HTTP.

## Puesta en uso

Desplegar backend aditivo antes de los clientes. APK firmado para piloto; ampliar tras aprobar mediciones reales. Antes de cambiar de aplicación, comprobar y completar/exportar los pendientes web: IndexedDB y el almacenamiento de Android son independientes. No desinstalar ni borrar almacenamiento para destrabar la cola.
