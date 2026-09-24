# Slidecast

ccmjs-Komponente für PDF-Folien mit optionalem Audio, HTML-Beschreibungen und Apps zwischen den Folien.

## Start

Das Repo ist eine Insellösung: Unter `libs` liegen das ccmjs-Framework, eine Kopie des PDF-Viewers inklusive PDF.js und Ressourcen sowie die Hello-App für die Demo. Andere Repos werden zur Laufzeit nicht benötigt.

Den Slidecast-Ordner per HTTP ausliefern:

```sh
python3 -m http.server 8767 --bind 127.0.0.1 --directory /Pfad/zu/slidecast
```

Dann `http://127.0.0.1:8767/` öffnen. Die Demo enthält drei PDF-Seiten und eine Hello-App zwischen den ersten beiden Seiten.

Komponenteneigene Ressourcenpfade beginnen mit `././`. Sie sind lokal relativ zur einbettenden Seite und werden bei der Versionierung automatisch durch absolute Pfade ersetzt. Die unveränderten Standardpfade der PDF-Viewer-Kopie werden in der `pdf_viewer`-Abhängigkeit für ihre Lage unter `libs/pdf_viewer` konfiguriert. Bei Aktualisierungen die Kopie samt Ressourcen und Lizenzen erneuern.

Nur eine PDF-URL genügt:

```js
const app = await ccm.start('./slidecast/ccm.slidecast.mjs', {
  pdf: './presentation.pdf'
}, document.querySelector('#slidecast'));
```

Das erzeugt `state.slides = [{ page: 1 }, { page: 2 }, …]`. Es werden keine JPEG-Dateien erzeugt: Ein einzelner PDF-Viewer rendert jeweils die benötigte PDF-Seite und behält Zoom, Textauswahl und Passwortdialog.

## Eigener Ablauf

```js
const app = await ccm.start('./slidecast/ccm.slidecast.mjs', {
  pdf: './presentation.pdf',
  viewer: { download: false, textSelection: true },
  comments: true,
  ignore: {
    slides: [
      { page: 1 },
      { page: 2, audio: './audio/02.mp3', description: '<h2>Vertiefung</h2><p>Erläuterung zur Folie.</p>' },
      { app: ['ccm.start', './quiz/ccm.quiz.mjs', { /* Quiz-Konfiguration */ }] },
      { page: 3 },
      { image: './images/extra.jpg', description: 'Zusätzliche Bildfolie' }
    ]
  }
}, document.querySelector('#slidecast'));
```

`ignore.slides` definiert die vollständige Reihenfolge. Jeder Eintrag enthält genau eines von `page` (PDF-Seite ab 1), `image` (Bild-URL) oder `app` (`ccm.start`-Abhängigkeit). `audio`, `description` und bei Bildern `title` als Alternativtext sind optional. Ein leerer Ablauf erzeugt alle PDF-Seiten automatisch. Ein reiner Bild-/App-Ablauf braucht kein PDF.

Der `ignore`-Bereich ist bewusst gewählt: ccmjs löst dort Abhängigkeiten nicht schon bei der Initialisierung auf. So bleiben die App-Abhängigkeiten im State serialisierbar und starten erst beim ersten Besuch ihres Schritts. Eingebettete Apps behalten beim Zurückblättern ihre Instanz und ihre Eingaben. Konfiguration und State sollen JSON-kompatible Daten enthalten; Module können mit `ccm.load` innerhalb der App-Abhängigkeit geladen werden.

Beschreibungen unterstützen `h2`–`h4`, `p`, `br`, `strong`, `em`, `b`, `i`, `ul`, `ol`, `li`, `blockquote`, `code`, `pre` und `a`. Andere Elemente samt Inhalt und alle Attribute außer sicheren Link-Zielen werden entfernt. Medien-URLs unterstützen HTTP(S) und Blob-URLs. Relative Medien-URLs beziehen sich auf die einbettende Seite. Externe PDFs benötigen passende CORS-Header.

Audio verwendet native Browser-Steuerelemente und wird beim Wechsel angehalten. Standardmäßig startet es per Klick. `comments: true` zeigt unter jeder Folie einen Platzhalter für die später zu entwickelnde Kommentierungs-Komponente; unter App-Schritten erscheint kein Kommentarbereich. Es werden noch keine Kommentare gespeichert.

## Autoplay

Mit `autoplay: true` versucht die Komponente, Audio beim Aufrufen einer Folie automatisch abzuspielen. Nach dem Audioende folgt nach `autoplayDelay` Millisekunden der nächste Schritt (Standard: `1000`, also eine Sekunde). Autoplay ist standardmäßig ausgeschaltet; die englische Demo aktiviert es.

```js
{ autoplay: true, autoplayDelay: 1000 }
```

Browser können den ersten automatischen Audiostart blockieren. In diesem Fall startet man die Wiedergabe über den Audio-Player; danach funktioniert das automatische Weiterblättern ebenso. Folien ohne Audio und App-Schritte werden nicht automatisch verlassen oder übersprungen. Am letzten Schritt endet der Ablauf. Manuelles Blättern, Neustart, Zerstören der Instanz sowie erneutes Abspielen oder Spulen brechen einen ausstehenden Wechsel ab. Bei deaktiviertem Autoplay bleibt man auch nach dem Audioende auf der Folie.

## Tastaturbedienung

Bei Fokus im Slidecast wechseln Pfeil links/rechts zum vorherigen/nächsten Schritt, einschließlich der eingebetteten Apps. An den Grenzen bleibt der aktuelle Schritt erhalten. Modifikatortasten und Tastenwiederholungen lösen keinen Wechsel aus. Eingabefelder, editierbare Inhalte, Audio-/Videoplayer und eingebettete Apps behalten ihre eigene Tastaturbedienung. Aus einer App heraus zuerst die Slidecast-Navigation fokussieren, um dort per Pfeiltasten weiterzublättern.

## State und API

```js
app.state = {
  pdf: './presentation.pdf',
  index: 0, // Aktueller Schritt, ab 0; Apps zählen mit.
  slides: [{ page: 1 }, { app: ['ccm.start', './quiz/ccm.quiz.mjs', {}] }]
};
```

- `await app.goTo(index)`: Schritt wechseln. Ungültige Indizes werden abgewiesen.
- `app.getValue()`: Tiefe, serialisierbare Kopie des State.
- `await app.start()`: Neuaufbau aus `pdf`, `viewer` und `ignore.slides`; bisherige Kindinstanzen werden freigegeben.
- `await app.destroy()`: Audio stoppen, Kindinstanzen freigeben, Oberfläche leeren. Ein erneuter Start ist möglich.
- `app.gui.busy`: Sperre während einer Aktion; gleichzeitige Aktionen werden ignoriert.
- `app.error`: Letzter Aktionsfehler; Fehler erscheinen zusätzlich in der Oberfläche.
- `extensions`: Funktionen mit `{ app, type }`, nacheinander ausgeführt. Ereignisse: `init`, `ready`, `before-start`, `render`, `start`, `change`, `error`, `destroy`. Nicht innerhalb einer laufenden Extension `destroy()` abwarten.

Snapshots können über `pdf: saved.pdf`, `ignore: { slides: saved.slides }` und nach dem Start `await app.goTo(saved.index)` wiederhergestellt werden. Zustand eingebetteter Apps ist nicht Teil dieses Snapshots. Zum Anpassen der Folien `ignore.slides` ändern und erneut starten; kein Autoreneditor und kein Upload-/Speicherdienst enthalten.

Die Slidecast-Navigation steuert den Gesamtablauf. Der PDF-Viewer wurde dafür um `navigation: false` erweitert (Seitenknöpfe, Seiteneingabe und Pfeiltasten aus). PDF-interne Links werden über die Slidecast-Navigation aufgelöst: Audio, Beschreibung und Kommentierung wechseln zusammen mit der Zielfolie. Links springen gezielt zur PDF-Seite und können dabei App-Schritte überspringen. Bei mehrfach vorkommenden PDF-Seiten wird die aktuelle, sonst die erste passende Folie verwendet. Nicht enthaltene Seiten ändern den aktuellen Schritt nicht; stattdessen erscheint ein Hinweis. Externe Links öffnen wie im PDF-Viewer einen neuen Tab. Mit `viewer: { links: false }` können alle PDF-Links deaktiviert werden. Zoom und optionaler Download bleiben verfügbar.

Apps mit Hintergrundaktivität sollten eine `destroy()`-Methode implementieren. Beim Verlassen eines App-Schritts wird dessen Oberfläche ausgehängt, die Instanz bleibt bis zum Neustart bzw. Zerstören erhalten.

## Prüfung

Mit Playwright und installiertem Browser bei laufendem Server:

```sh
SLIDECAST_URL=http://127.0.0.1:8767/ node --test test/slidecast.browser.test.mjs
```

Optional: `PLAYWRIGHT_PATH` (Modulpfad), `CHROME_PATH` (Browserdatei), `SLIDECAST_URL` (Demo-Adresse). Der Test prüft echtes PDF-Rendering, App-Einbettung, Navigation, Beschreibungsbereinigung, Audioelemente, mobile Breite, Neustart und Abbruch eines Passwortdialogs.
