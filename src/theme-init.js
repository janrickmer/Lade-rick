// Wird synchron im <head> geladen, damit das gewählte Design vor dem ersten Rendern gesetzt ist
// (kein Aufblitzen). Standard: Systemeinstellung (prefers-color-scheme). In localStorage wird nur
// dann etwas gespeichert, wenn die Darstellung bewusst umgeschaltet wurde – keine Nutzerdaten.
(function () {
  // Bewegungs-Ausgangszustände gelten nur mit Skript (ohne Skript bleibt alles sofort sichtbar)
  document.documentElement.classList.add('js');
  try {
    var stored = window.localStorage.getItem('laderick:theme');
    if (stored === 'dark' || stored === 'light') {
      document.documentElement.setAttribute('data-theme', stored);
    }
  } catch (e) {
    /* localStorage nicht verfügbar (privater Modus o. ä.) – Systemeinstellung gilt */
  }
})();
