/* Mat Study: English / Spanish.
   The app is written in English. When Spanish is chosen in Settings, this file swaps the app's own
   words on screen (buttons, menus, messages) for Spanish. Your own content (video names, bookmarks,
   notes, chapters, tags) is left exactly as you wrote it. */
(() => {
  'use strict';
  const KEY = 'bjj.lang';
  const saved = localStorage.getItem(KEY);
  const lang = saved === 'es' || saved === 'en' ? saved : ((navigator.language || '').toLowerCase().startsWith('es') ? 'es' : 'en');
  document.documentElement.lang = lang;

  const ES = {
    // tabs, top bar
    'Library': 'Biblioteca', 'Roadmap': 'Ruta', 'Study': 'Estudio', 'Settings': 'Ajustes', 'Offline': 'Sin conexión',
    'Loading…': 'Cargando…', 'Back': 'Atrás', 'Close': 'Cerrar', 'Cancel': 'Cancelar', 'Save': 'Guardar', 'Create': 'Crear',
    'Delete': 'Eliminar', 'Remove': 'Quitar', 'Undo': 'Deshacer', 'Restore': 'Restaurar', 'Add': 'Agregar', 'Get': 'Obtener',
    'Search': 'Buscar', 'Filter': 'Filtrar', 'More options': 'Más opciones', 'On': 'Encendido', 'Off': 'Apagado', 'All': 'Todo',
    'General': 'General', 'Saved ✓': 'Guardado ✓', 'Saving…': 'Guardando…', 'Copied ✓': 'Copiado ✓', 'Folder': 'Carpeta',
    'Something went wrong': 'Algo salió mal',

    // sign-in and gate screens
    'Your private BJJ instructional player.': 'Tu reproductor privado de instruccionales de BJJ.',
    'Sign in with Microsoft': 'Iniciar sesión con Microsoft',
    'Your sign-in expired (for safety it only lasts about a day). Tap below to sign in again.': 'Tu sesión expiró (por seguridad dura alrededor de un día). Toca abajo para entrar de nuevo.',
    'Sign-in check failed. Please try again.': 'Falló la verificación de inicio de sesión. Inténtalo de nuevo.',
    'Private app': 'App privada',
    'This app only works for accounts its owner has invited.': 'Esta app solo funciona con las cuentas que su dueño invitó.',
    'If the owner invited you, send them this code. Once they add it, sign in again.': 'Si el dueño te invitó, envíale este código. Cuando lo agregue, vuelve a iniciar sesión.',
    'Copy code': 'Copiar código', 'Use a different account': 'Usar otra cuenta', 'One last step': 'Un último paso',
    'Almost ready': 'Casi listo', 'Try demo mode': 'Probar modo demo',

    // library / home
    '🔍 Search all videos…': '🔍 Buscar en todos los videos…', '▶ Continue watching': '▶ Seguir viendo',
    '⭐ Favorite videos': '⭐ Videos favoritos', '⭐ Favorite instructionals': '⭐ Instruccionales favoritos',
    '📼 Instructionals': '📼 Instruccionales', 'Not started': 'Sin empezar', 'Not found': 'No encontrado',
    'Pick your BJJ folder': 'Elige tu carpeta de BJJ',
    'Choose the OneDrive folder where your instructionals are. You only do this once.': 'Elige la carpeta de OneDrive donde están tus instruccionales. Solo lo haces una vez.',
    'Choose folder': 'Elegir carpeta', 'Choose another folder': 'Elegir otra carpeta', 'No videos found': 'No se encontraron videos',
    'Finding your videos…': 'Buscando tus videos…',
    'Only names are read, nothing is downloaded. You only wait like this once.': 'Solo se leen los nombres, no se descarga nada. Solo esperas así una vez.',
    'Scan stopped': 'Escaneo detenido', 'Your videos are not loaded yet. Start again when you are ready.': 'Tus videos aún no están cargados. Empieza de nuevo cuando quieras.',
    'Start scan again': 'Escanear de nuevo', 'Nothing found': 'No se encontró nada',
    'Try a different word, like "guard" or "heel hook".': 'Prueba otra palabra, como "guard" o "heel hook".',
    'Back to library': 'Volver a la biblioteca', '‹ Library': '‹ Biblioteca', 'This folder is not in your library.': 'Esta carpeta no está en tu biblioteca.',
    'Nothing tagged yet': 'Nada etiquetado todavía', 'Video not found': 'Video no encontrado', 'Video not in library': 'Video que no está en la biblioteca',
    'Try "Rescan library" in Settings.': 'Prueba "Volver a escanear" en Ajustes.',

    // instructional page
    '☆ Favorite': '☆ Favorito', '⭐ Favorite': '⭐ Favorito', '🗺️ Add to roadmap': '🗺️ Agregar a una ruta', '✓ Mark all done': '✓ Marcar todo como visto',
    'Mark done': 'Marcar como visto', 'Mark as done': 'Marcar como visto', '✓ Done': '✓ Visto', 'Done': 'Visto',
    '🏷️ + Add tags': '🏷️ + Agregar etiquetas', 'Edit tags': 'Editar etiquetas', 'Make your own tag…': 'Crea tu propia etiqueta…', '+ Add': '+ Agregar',
    'Tags saved 🏷️': 'Etiquetas guardadas 🏷️', 'Tags removed': 'Etiquetas quitadas',
    '📑 Chapters': '📑 Capítulos', 'Chapters': 'Capítulos', '📑 Add table of contents': '📑 Agregar índice', 'Replace file': 'Reemplazar archivo',
    'Add this instructional\'s table-of-contents file (.html) to see chapters under each video. Or put the file in this instructional\'s OneDrive folder and tap': 'Agrega el archivo de índice (.html) de este instruccional para ver los capítulos de cada video. O pon el archivo en la carpeta de OneDrive del instruccional y toca',
    'in Settings.': 'en Ajustes.', 'From': 'De',
    'Or paste the BJJ Fanatics link for this instructional:': 'O pega el enlace de BJJ Fanatics de este instruccional:',
    'Chapters removed': 'Capítulos quitados', "Couldn't find any chapter times in that file.": 'No se encontraron tiempos de capítulos en ese archivo.',
    'That file is too big for a table of contents.': 'Ese archivo es demasiado grande para un índice.',
    "That page doesn't list chapter times.": 'Esa página no tiene tiempos de capítulos.',
    "Couldn't read that page. Check the link and try again.": 'No se pudo leer esa página. Revisa el enlace e inténtalo de nuevo.',
    'Paste a BJJ Fanatics product link, like https://bjjfanatics.com/products/…': 'Pega un enlace de producto de BJJ Fanatics, como https://bjjfanatics.com/products/…',
    'You are offline.': 'No tienes conexión.',

    // player
    'Play': 'Reproducir', 'Seek': 'Buscar posición', 'Back 10 seconds': 'Atrás 10 segundos', 'Forward 10 seconds': 'Adelante 10 segundos',
    'Previous video': 'Video anterior', 'Next video': 'Siguiente video', 'Fullscreen': 'Pantalla completa', 'Auto-play next video': 'Reproducir el siguiente automáticamente',
    'Mark': 'Marcar', 'Mirror': 'Espejo', 'Mirrored': 'En espejo', 'Normal': 'Normal',
    '‹ Previous video': '‹ Video anterior', 'Next video ›': 'Siguiente video ›',
    'Loading video…': 'Cargando video…', 'Tap ▶ to play': 'Toca ▶ para reproducir', 'Demo video missing': 'Falta el video de demo',
    'Could not load the video.': 'No se pudo cargar el video.', 'You are offline. Videos need internet.': 'No tienes conexión. Los videos necesitan internet.',
    'Could not open this video in OneDrive.': 'No se pudo abrir este video en OneDrive.',
    'Sleep timer': 'Temporizador', 'Playback speed': 'Velocidad', 'Loop a move': 'Repetir un movimiento', 'Stop loop': 'Detener repetición',
    'Mini player': 'Mini reproductor', 'Auto-play next': 'Reproducción automática', 'Setting end…': 'Marcando el final…',
    '10 minutes': '10 minutos', '15 minutes': '15 minutos', '30 minutes': '30 minutos', '45 minutes': '45 minutos', '1 hour': '1 hora',
    'End of this video': 'Al terminar este video', 'End of video': 'Fin del video',
    'Sleep timer off': 'Temporizador apagado', '🌙 Will pause at the end of this video': '🌙 Se pausará al terminar este video',
    '🌙 Sleep timer: video paused': '🌙 Temporizador: video en pausa', '🌙 Sleep timer: stopped at the end of the video': '🌙 Temporizador: se detuvo al terminar el video',
    'Mini player is not available right now.': 'El mini reproductor no está disponible ahora.',
    'Loop off': 'Repetición apagada', 'Play forward a bit, then tap again to set the end.': 'Avanza un poco y toca otra vez para marcar el final.',
    'Auto-play is off': 'Reproducción automática apagada', 'Auto-play is on ⏭️ The next video will start by itself.': 'Reproducción automática encendida ⏭️ El siguiente video empezará solo.',
    'Up next in': 'Sigue en', 'Play now': 'Reproducir ya', 'Finished! 🎉': '¡Terminado! 🎉', 'Finished this series! 🎉': '¡Terminaste esta serie! 🎉',
    'Start over': 'Empezar de nuevo', '🔖 Bookmarks': '🔖 Marcadores', '📝 Notes': '📝 Notas',
    'No bookmarks yet. Tap 🔖 Mark while watching to save a moment.': 'Aún no hay marcadores. Toca 🔖 Marcar mientras ves para guardar un momento.',
    'What did you learn? Key details, grips, mistakes…': '¿Qué aprendiste? Detalles clave, agarres, errores…',
    'Added to favorites ⭐': 'Agregado a favoritos ⭐', 'Removed from favorites': 'Quitado de favoritos',

    // bookmark popup and drill lists
    'e.g. Kimura grip detail': 'ej. Detalle del agarre de kimura', '🥋 Also add as a drill to:': '🥋 Agregar también como drill a:',
    'No, just a bookmark': 'No, solo marcador', '➕ New list…': '➕ Lista nueva…', 'Name the new list, e.g. Guard drills': 'Nombra la lista nueva, ej. Drills de guardia',
    'Bookmark saved': 'Marcador guardado', 'Add to which drill list?': '¿A qué lista de drills?', 'Name your new drill list': 'Nombra tu nueva lista de drills',
    'e.g. Guard drills': 'ej. Drills de guardia', 'Add to drills': 'Agregar a drills', 'Rename bookmark': 'Renombrar marcador',

    // roadmaps
    '🗺️ Roadmaps': '🗺️ Rutas', '+ New roadmap': '+ Ruta nueva', 'No roadmap yet': 'Aún no hay rutas',
    'A roadmap is your study order: instructional 1, then 2, then 3. Give it a name like "Leg lock path".': 'Una ruta es tu orden de estudio: instruccional 1, luego 2, luego 3. Ponle un nombre como "Ruta de leg locks".',
    '+ Create my first roadmap': '+ Crear mi primera ruta', 'Finish one instructional, then the next one is up.': 'Termina un instruccional y sigue el próximo.',
    'No steps yet. Add instructionals below in the order you want to study them.': 'Aún no hay pasos. Agrega instruccionales abajo en el orden que quieras estudiarlos.',
    '🏆 You finished this roadmap! Add the next instructional below.': '🏆 ¡Terminaste esta ruta! Agrega el próximo instruccional abajo.',
    '📝 Notes for this roadmap': '📝 Notas de esta ruta', 'Goals, ideas, what to focus on…': 'Metas, ideas, en qué enfocarte…',
    '🥋 Drills for this roadmap': '🥋 Drills de esta ruta', 'Add a drill…': 'Agrega un drill…', 'No drills yet.': 'Aún no hay drills.',
    '➕ Add an instructional': '➕ Agregar un instruccional', 'Search instructionals…': 'Buscar instruccionales…', 'No matches.': 'Sin resultados.',
    'Move up': 'Subir', 'Move down': 'Bajar', 'Rename roadmap': 'Renombrar ruta', 'Archive roadmap': 'Archivar ruta', 'Delete roadmap': 'Eliminar ruta',
    'Name your roadmap': 'Nombra tu ruta', 'Name your first roadmap': 'Nombra tu primera ruta', 'e.g. Leg lock path': 'ej. Ruta de leg locks',
    'e.g. Leg lock path, Guard game': 'ej. Ruta de leg locks, Juego de guardia', 'Roadmap created 🗺️': 'Ruta creada 🗺️', 'Removed from roadmap': 'Quitado de la ruta',
    'Add to which roadmap?': '¿A qué ruta?', 'My roadmap': 'Mi ruta', 'Open this roadmap ›': 'Abrir esta ruta ›',
    '🗄 Archived roadmaps': '🗄 Rutas archivadas', 'Roadmaps you archive show up here.': 'Las rutas que archives aparecen aquí.',
    'Hidden from your roadmaps, along with their notes and drills. ↩ brings one back, 🗑 deletes it.': 'Ocultas de tus rutas, junto con sus notas y drills. ↩ la recupera, 🗑 la elimina.',

    // study
    '🥋 Drills': '🥋 Drills', 'Drills': 'Drills', '+ New list': '+ Lista nueva', '+ New note': '+ Nota nueva', 'New list': 'Lista nueva',
    'Name your drill list': 'Nombra tu lista de drills', 'e.g. This week, Guard drills': 'ej. Esta semana, Drills de guardia', 'List created 🥋': 'Lista creada 🥋',
    'Rename list': 'Renombrar lista', 'Rename list…': 'Renombrar lista…', 'Archive list': 'Archivar lista', 'Delete list': 'Eliminar lista',
    'Add moves you want to practice.': 'Agrega movimientos que quieras practicar.', 'This list is empty': 'Esta lista está vacía',
    'No bookmarks yet': 'Aún no hay marcadores', 'While watching, tap 🔖 Mark to save a moment.': 'Mientras ves, toca 🔖 Marcar para guardar un momento.',
    'No notes yet': 'Aún no hay notas', 'Tap "+ New note", or write notes under any video.': 'Toca "+ Nota nueva", o escribe notas debajo de cualquier video.',
    'No matches': 'Sin resultados', 'Try another word.': 'Prueba otra palabra.', 'Watch': 'Ver', 'Move to another list': 'Mover a otra lista',
    'Nothing archived': 'No hay nada archivado', 'Bookmarks you archive show up here.': 'Los marcadores que archives aparecen aquí.',
    'Notes you archive show up here.': 'Las notas que archives aparecen aquí.', 'Drills and lists you archive show up here.': 'Los drills y listas que archives aparecen aquí.',
    'Hidden from your lists. ↩ brings one back, 🗑 deletes it.': 'Ocultos de tus listas. ↩ lo recupera, 🗑 lo elimina.',
    'Lists': 'Listas', 'Untitled note': 'Nota sin título', 'Note name': 'Nombre de la nota', '‹ Notes': '‹ Notas',
    'Write anything: game plan, competition notes, ideas…': 'Escribe lo que quieras: plan de juego, notas de competencia, ideas…',
    'Delete note': 'Eliminar nota', '🗄 Archive': '🗄 Archivar', '↩ Restore': '↩ Restaurar', 'Delete this note?': '¿Eliminar esta nota?',
    '✎ Rename': '✎ Renombrar', '⇄ Move to another list': '⇄ Mover a otra lista', '🗄 Archive (hide, keep it)': '🗄 Archivar (ocultar y guardar)',
    '🗑 Delete': '🗑 Eliminar', '🗄 Archive them (hide, keep them)': '🗄 Archivarlos (ocultar y guardar)', '🗑 Delete them': '🗑 Eliminarlos',
    'Bookmark': 'Marcador', 'Drill': 'Drill', 'Note': 'Nota', 'Video note': 'Nota de video', 'Drill list': 'Lista de drills',
    'Bookmark deleted': 'Marcador eliminado', 'Drill deleted': 'Drill eliminado', 'Note deleted': 'Nota eliminada', 'Roadmap deleted': 'Ruta eliminada',
    'List deleted': 'Lista eliminada', 'Video note deleted': 'Nota de video eliminada', 'Drill list deleted': 'Lista de drills eliminada',

    // settings
    '📁 Library': '📁 Biblioteca', 'Folder:': 'Carpeta:', 'Change folder': 'Cambiar carpeta', 'Rescan for new videos': 'Buscar videos nuevos',
    'Scanning…': 'Escaneando…', 'Looking…': 'Buscando…', '📑 Find chapter files': '📑 Buscar archivos de capítulos',
    '"Find chapter files" only looks for table-of-contents (.html) files, so it\'s much faster than a full rescan.': '"Buscar archivos de capítulos" solo busca archivos de índice (.html), así que es mucho más rápido que escanear todo.',
    '■ Stop': '■ Detener', 'Stopping…': 'Deteniendo…', '■ Stopping…': '■ Deteniendo…', '📑 Finding chapters…': '📑 Buscando capítulos…',
    'Library updated ✓': 'Biblioteca actualizada ✓', 'Scan stopped. Your library is the same as before.': 'Escaneo detenido. Tu biblioteca quedó igual que antes.',
    'A scan is already running. Wait for it or stop it first.': 'Ya hay un escaneo en curso. Espera o detenlo primero.',
    'Stopped looking for chapter files.': 'Se dejó de buscar archivos de capítulos.',
    'No chapter files found. Put the .html file inside the instructional folder.': 'No se encontraron archivos de capítulos. Pon el archivo .html dentro de la carpeta del instruccional.',
    '📱 App': '📱 App', 'Installed on your home screen ✓': 'Instalada en tu pantalla de inicio ✓', 'Add to home screen': 'Agregar a la pantalla de inicio',
    'To add it to your home screen: in Chrome tap': 'Para agregarla a tu pantalla de inicio: en Chrome toca', 'then': 'y luego', 'Add to Home screen': 'Agregar a la pantalla principal',
    '☀️ Light mode': '☀️ Modo claro', '🌙 Dark mode': '🌙 Modo oscuro', '🌐 Language': '🌐 Idioma', '📖 User guide': '📖 Guía de uso',
    '🏷️ My custom tags': '🏷️ Mis etiquetas', 'None yet. Make one from "🏷️ + Add tags" on any video or instructional.': 'Ninguna todavía. Crea una desde "🏷️ + Agregar etiquetas" en cualquier video o instruccional.',
    'Delete tag': 'Eliminar etiqueta', 'Tag deleted': 'Etiqueta eliminada',
    '☁️ Backup': '☁️ Respaldo', 'Bookmarks, notes and progress are saved on this phone and backed up to a private app folder in your OneDrive (': 'Los marcadores, notas y progreso se guardan en este teléfono y se respaldan en una carpeta privada de la app en tu OneDrive (',
    'Apps › Mat Study': 'Aplicaciones › Mat Study', 'Back up now': 'Respaldar ahora', 'Download a copy': 'Descargar una copia',
    'Backed up ✓': 'Respaldado ✓', 'Backup failed, will retry': 'Falló el respaldo, se volverá a intentar',
    '🔒 Safety': '🔒 Seguridad', '✓ Only your Microsoft account can open this app.': '✓ Solo tu cuenta de Microsoft (y las que invites) puede abrir esta app.',
    '✓ It can only': '✓ Solo puede', 'read': 'leer', 'your files. It cannot change or delete them.': 'tus archivos. No puede cambiarlos ni borrarlos.',
    '✓ No server and no other company in between: your phone talks straight to Microsoft.': '✓ Sin servidor ni otra empresa en medio: tu teléfono habla directo con Microsoft.',
    'Signed in as': 'Sesión iniciada como', 'Sign out': 'Cerrar sesión', 'Sign out of Mat Study?': '¿Cerrar sesión en Mat Study?',
    'not chosen': 'sin elegir', '(🔗 shared with you)': '(🔗 compartida contigo)', 'demo mode': 'modo demo',

    // folder picker and shared links
    'Choose your BJJ folder': 'Elige tu carpeta de BJJ', 'Open the folder that holds your instructionals, then tap the green button.': 'Abre la carpeta que tiene tus instruccionales y luego toca el botón verde.',
    'My files': 'Mis archivos', '‹ Up': '‹ Subir', 'No folders inside.': 'No hay carpetas adentro.',
    '🔗 Use a folder someone shared with you': '🔗 Usar una carpeta que alguien compartió contigo',
    'Paste the OneDrive link they sent you. You only do this once.': 'Pega el enlace de OneDrive que te enviaron. Solo lo haces una vez.',
    'Use link': 'Usar enlace', 'Paste the OneDrive link, like https://1drv.ms/…': 'Pega el enlace de OneDrive, como https://1drv.ms/…',
    'Microsoft will ask you to allow "read files shared with you". It is still read-only.': 'Microsoft te pedirá permitir "leer archivos compartidos contigo". Sigue siendo solo lectura.',
    "Couldn't open that link. Ask your friend to check it's shared with your account.": 'No se pudo abrir ese enlace. Pídele a tu amigo que revise que esté compartido con tu cuenta.',
    'That link is to a single file. Ask for a link to the folder instead.': 'Ese enlace es de un solo archivo. Pide el enlace de la carpeta.',
    "Couldn't open that folder.": 'No se pudo abrir esa carpeta.', "That link isn't shared with this Microsoft account.": 'Ese enlace no está compartido con esta cuenta de Microsoft.',
    "Couldn't open that link. Check it and try again.": 'No se pudo abrir ese enlace. Revísalo e inténtalo de nuevo.',
    'Demo mode: loads sample folders.': 'Modo demo: carga carpetas de ejemplo.', 'Use demo folder': 'Usar carpeta de demo',
    'Demo mode: shared links only work when signed in.': 'Modo demo: los enlaces compartidos solo funcionan con sesión iniciada.',
  };

  const ago = s => s.replace(/^just now$/, 'justo ahora').replace(/^never$/, 'nunca').replace(/^(\d+) min ago$/, 'hace $1 min')
    .replace(/^(\d+) h ago$/, 'hace $1 h').replace(/^(\d+) days ago$/, 'hace $1 días');
  const pl = (n, one, many) => (+n === 1 ? one : many);
  const kinds = { Bookmark: ['Marcador', 'o'], Drill: ['Drill', 'o'], Note: ['Nota', 'a'], 'Video note': ['Nota de video', 'a'], 'Drill list': ['Lista de drills', 'a'], Roadmap: ['Ruta', 'a'] };
  const tabs = { bookmarks: 'marcadores', notes: 'notas', drills: 'drills' };
  // Sentences with numbers or names inside.
  const P = [
    [/^(\d+) of (\d+) done$/, (_, a, b) => `${a} de ${b} vistos`],
    [/^(\d+)\/(\d+) done$/, (_, a, b) => `${a}/${b} vistos`],
    [/^(\d+) videos?$/, (_, n) => `${n} video${pl(n, '', 's')}`],
    [/^(\d+) videos? · (\d+) done$/, (_, n, d) => `${n} video${pl(n, '', 's')} · ${d} visto${pl(d, '', 's')}`],
    [/^(\d+) instructionals? ›$/, (_, n) => `${n} instruccional${pl(n, '', 'es')} ›`],
    [/^(\d+) instructionals? · (\d+) videos?$/, (_, a, b) => `${a} instruccional${pl(a, '', 'es')} · ${b} video${pl(b, '', 's')}`],
    [/^(\d+) videos? · checked (.+)$/, (_, n, t) => `${n} video${pl(n, '', 's')} · revisado ${ago(t)}`],
    [/^(just now|never|\d+ min ago|\d+ h ago|\d+ days ago)$/, m => ago(m)],
    [/^(\d+) items ›$/, (_, n) => `${n} elemento${pl(n, '', 's')} ›`],
    [/^(\d+) videos? directly in this folder\.$/, (_, n) => `${n} video${pl(n, '', 's')} directamente en esta carpeta.`],
    [/^✓ Use "(.*)"$/, (_, x) => `✓ Usar "${x}"`],
    [/^Bookmark at (.+)$/, (_, t) => `Marcador en ${t}`],
    [/^Tags for (.+)$/, (_, x) => `Etiquetas de ${x}`],
    [/^Filter (.+)'s instructionals…$/, (_, x) => `Filtrar instruccionales de ${x}…`],
    [/^Search (bookmarks|notes|drills)… \(e\.g\. kimura\)$/, (_, x) => `Buscar ${tabs[x]}… (ej. kimura)`],
    [/^🎬 Videos \((\d+)\)$/, (_, n) => `🎬 Videos (${n})`],
    [/^📼 Instructionals \((\d+)\)$/, (_, n) => `📼 Instruccionales (${n})`],
    [/^🗄 Archived \((\d+)\)$/, (_, n) => `🗄 Archivado (${n})`],
    [/^🗄 Archived (bookmarks|notes|drills)$/, (_, x) => `🗄 ${x === 'notes' ? 'Notas archivadas' : x === 'drills' ? 'Drills archivados' : 'Marcadores archivados'}`],
    [/^· (\d+) of (\d+) videos have chapters$/, (_, a, b) => `· ${a} de ${b} videos tienen capítulos`],
    [/^No chapters for: (.+)$/, (_, x) => `Sin capítulos: ${x}`],
    [/^The file has (\d+) volumes but this folder has (\d+) videos, so they couldn't be matched\. Names with "Vol 1", "Vol 2"… match best\.$/,
      (_, a, b) => `El archivo tiene ${a} volúmenes pero esta carpeta tiene ${b} videos, así que no se pudieron emparejar. Los nombres con "Vol 1", "Vol 2"… funcionan mejor.`],
    [/^📑 Chapters added to (\d+) of (\d+) videos$/, (_, a, b) => `📑 Capítulos agregados a ${a} de ${b} videos`],
    [/^Found (\d+) volumes, but couldn't match them to the videos\.$/, (_, n) => `Se encontraron ${n} volúmenes, pero no se pudieron emparejar con los videos.`],
    [/^📑 Added chapters to (\d+) instructionals?(?: \((\d+) couldn't be read\))?$/, (_, n, f) => `📑 Capítulos agregados a ${n} instruccional${pl(n, '', 'es')}${f ? ` (${f} no se pudieron leer)` : ''}`],
    [/^Found (\d+) chapter files?, all already loaded ✓$/, (_, n) => `Se encontraron ${n} archivo${pl(n, '', 's')} de capítulos, ya cargado${pl(n, '', 's')} ✓`],
    [/^Found (\d+) chapter files? but couldn't read (?:it|them)\.$/, (_, n) => `Se encontraron ${n} archivo${pl(n, '', 's')} de capítulos pero no se pudo${pl(n, '', 'ieron')} leer.`],
    [/^Found (\d+) \.html files?, but not inside an instructional folder\.$/, (_, n) => `Se encontraron ${n} archivo${pl(n, '', 's')} .html, pero no dentro de la carpeta de un instruccional.`],
    [/^From BJJ Fanatics: (.+)$/, (_, x) => `De BJJ Fanatics: ${x}`],
    [/^Last backup: (.+?)( \(will retry\))?$/, (_, t, r) => `Último respaldo: ${t === 'demo mode' ? 'modo demo' : ago(t)}${r ? ' (se volverá a intentar)' : ''}`],
    [/^Open an instructional or video and tap "🏷️ \+ Add tags" to tag it "(.+)"\.$/, (_, x) => `Abre un instruccional o video y toca "🏷️ + Agregar etiquetas" para etiquetarlo "${x}".`],
    [/^Resumed at (.+)$/, (_, t) => `Continuando en ${t}`],
    [/^Loop start set at (.+)\. Tap the 🔁 pill on the video at the end of the move\.$/, (_, t) => `Inicio de repetición en ${t}. Toca la píldora 🔁 en el video al final del movimiento.`],
    [/^Looping (.+) → (.+)$/, (_, a, b) => `Repitiendo ${a} → ${b}`],
    [/^🔁 Start (.+) · tap here at the end$/, (_, t) => `🔁 Inicio ${t} · toca aquí al final`],
    [/^🔁 (.+)–(.+) ✕ Stop$/, (_, a, b) => `🔁 ${a}–${b} ✕ Detener`],
    [/^(\d+) min left$/, (_, n) => `quedan ${n} min`],
    [/^Pausing in (\d+) min\.$/, (_, n) => `Se pausará en ${n} min.`],
    [/^🌙 Will pause in (\d+) minutes$/, (_, n) => `🌙 Se pausará en ${n} minutos`],
    [/^(\d+)% · checked (\d+) folders? · found (\d+) videos?$/, (_, p, f, v) => `${p}% · ${f} carpeta${pl(f, '', 's')} revisada${pl(f, '', 's')} · ${v} video${pl(v, '', 's')}`],
    [/^📑 Looking for chapter files… checked (\d+) files? · found (\d+)$/, (_, f, n) => `📑 Buscando archivos de capítulos… ${f} archivo${pl(f, '', 's')} revisado${pl(f, '', 's')} · ${n} encontrado${pl(n, '', 's')}`],
    [/^(\d+)% · reading chapter files (\d+) of (\d+)$/, (_, p, a, b) => `${p}% · leyendo archivos de capítulos ${a} de ${b}`],
    [/^🔄 Scanning (\d+)%$/, (_, p) => `🔄 Escaneando ${p}%`],
    [/^Looking in "(.+)"$/, (_, x) => `Buscando en "${x}"`],
    [/^There are no MP4 videos in "(.+)"\.$/, (_, x) => `No hay videos MP4 en "${x}".`],
    [/^Added to "(.+)" as step (\d+) 🗺️$/, (_, x, n) => `Agregado a "${x}" como paso ${n} 🗺️`],
    [/^Moved to (.+)$/, (_, x) => `Movido a ${x}`],
    [/^Added to (.+) 🥋$/, (_, x) => `Agregado a ${x} 🥋`],
    [/^Bookmark saved \+ added to (.+) 🥋$/, (_, x) => `Marcador guardado + agregado a ${x} 🥋`],
    [/^(\d+) finished drills?$/, (_, n) => `${n} drill${pl(n, '', 's')} terminado${pl(n, '', 's')}`],
    [/^Tidy up (\d+) finished…$/, (_, n) => `Ordenar ${n} terminado${pl(n, '', 's')}…`],
    [/^(\d+) drills? (archived|deleted)$/, (_, n, h) => `${n} drill${pl(n, '', 's')} ${h === 'archived' ? 'archivado' : 'eliminado'}${pl(n, '', 's')}`],
    [/^(\d+) drills$/, (_, n) => `${n} drills`],
    [/^(\d+) steps$/, (_, n) => `${n} paso${pl(n, '', 's')}`],
    [/^(Bookmark|Drill|Note|Video note|Drill list|Roadmap) (archived 🗄|restored ↩)$/, (_, k, h) => `${kinds[k][0]} ${h.startsWith('archived') ? 'archivad' + kinds[k][1] + ' 🗄' : 'restaurad' + kinds[k][1] + ' ↩'}`],
    [/^Delete (bookmark|drill|note|video note|drill list|roadmap) "(.*)"\?( Its drills move to General\.)?$/,
      (_, k, x, g) => `¿Eliminar ${({ bookmark: 'el marcador', drill: 'el drill', note: 'la nota', 'video note': 'la nota de video', 'drill list': 'la lista de drills', roadmap: 'la ruta' })[k]} "${x}"?${g ? ' Sus drills pasan a General.' : ''}`],
    [/^Delete the tag "(.+)"\? It will be removed from everything that has it\.$/, (_, x) => `¿Eliminar la etiqueta "${x}"? Se quitará de todo lo que la tenga.`],
    [/^Mark all (\d+) videos in "(.+)" as done\?$/, (_, n, x) => `¿Marcar los ${n} videos de "${x}" como vistos?`],
    [/^📁 Using "(.+)"$/, (_, x) => `📁 Usando "${x}"`],
    [/^▶ Continue: (.+)$/, (_, x) => `▶ Continuar: ${x}`],
    [/^Next: (.+)$/, (_, x) => `Siguiente: ${x}`],
    [/^🗺️ (.+) · step (\d+) of (\d+)$/, (_, x, a, b) => `🗺️ ${x} · paso ${a} de ${b}`],
    [/^🗺️ (.+) · step (\d+)$/, (_, x, a) => `🗺️ ${x} · paso ${a}`],
    [/^(.*?)(▶ Studying now · |Finished · )?(\d+)\/(\d+) videos$/, (_, g, st, a, b) => `${g}${st ? (st.startsWith('▶') ? '▶ Estudiando ahora · ' : 'Terminado · ') : ''}${a}/${b} videos`],
    [/^(\d+) instructionals · (\d+) videos · (\d+) done$/, (_, a, b, c) => `${a} instruccionales · ${b} videos · ${c} vistos`],
  ];

  function tr(s) {
    if (lang !== 'es' || typeof s !== 'string' || !/[A-Za-z]/.test(s)) return s;
    const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/), core = m[2].replace(/\s+/g, ' ');
    if (Object.prototype.hasOwnProperty.call(ES, core)) return m[1] + ES[core] + m[3];
    for (const [re, f] of P) { const x = core.match(re); if (x) return m[1] + f(...x) + m[3]; }
    return s;
  }

  // Swap the words on screen. Anything inside translate="no" (your own content) is skipped.
  const ATTRS = ['placeholder', 'aria-label', 'title'];
  const skip = el => !el || el.closest('[translate="no"], script, style, textarea, code');
  const skipAttr = el => !el || el.closest('[translate="no"]');
  function doText(n) {
    if (!n.parentElement || skip(n.parentElement)) return;
    const v = n.nodeValue, t = tr(v);
    if (t !== v) n.nodeValue = t;
  }
  function doEl(el) {
    if (skipAttr(el)) return;
    for (const a of ATTRS) { const v = el.getAttribute(a); if (v) { const t = tr(v); if (t !== v) el.setAttribute(a, t); } }
  }
  function walk(root) {
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1) return;
    doEl(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = w.nextNode())) n.nodeType === 3 ? doText(n) : doEl(n);
  }
  if (lang === 'es') {
    walk(document.body);
    new MutationObserver(list => {
      for (const m of list) {
        if (m.type === 'characterData') doText(m.target);
        else if (m.type === 'attributes') doEl(m.target);
        else m.addedNodes.forEach(walk);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    const c = window.confirm.bind(window);
    window.confirm = msg => c(tr(msg));
  }

  window.I18N = { lang, tr, set(l) { localStorage.setItem(KEY, l); location.reload(); } };
})();
