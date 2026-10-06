# Slidecast

A ccmjs component for PDF slides with optional audio, HTML descriptions and apps between slides. The default interface is English.

## Quick start

The `libs` directory contains ccmjs `28.0.0` and the PDF Viewer component `1.0.0`. The viewer loads PDF.js `6.3.289` and its other resources through its release's absolute CDN URLs. The demo PDF and the demo's Hello app (`1.0.3`) are also loaded through jsDelivr. These resources require an internet connection.

Serve the Slidecast directory over HTTP:

```sh
python3 -m http.server 8767 --bind 127.0.0.1 --directory /path/to/slidecast
```

Open [the local demo](http://127.0.0.1:8767/). It contains three PDF pages, an audio introduction and a Hello app between the first two pages.

Component-owned resource paths begin with `././`. During local development they are relative to the embedding page; the versioning process replaces them with absolute URLs. The PDF Viewer copy retains its CDN paths pinned to version `1.0.0` for `libs` and `resources`. Update its component file, license and version references together.

To display your own PDF from a page served at the repository root:

```html
<script src="./libs/framework/ccm-28.0.0.min.js"></script>
<div id="slidecast"></div>
<script type="module">
  const app = await ccm.start('./ccm.slidecast.mjs', {
    pdf: './presentation.pdf'
  }, document.querySelector('#slidecast'));
</script>
```

This generates `state.slides = [{ page: 1 }, { page: 2 }, …]`. No JPEG files are generated: a single PDF Viewer renders the requested page and provides zoom, text selection and a password prompt when needed.

## 📦 Usage with CDN (versioned)

```html
<script
    src="https://cdn.jsdelivr.net/gh/ccmjs/slidecast@v1.0.0/libs/framework/ccm-28.0.0.min.js"
    integrity="sha384-HDMeDDgKlR2OFJ3ECMwmA6wknqpfpeCiSZYlUhQaFg9FKrvHJp8MMSwrxibvWJ2G"
    crossorigin="anonymous"
></script>
<div id="slidecast"></div>
<script type="module">
  const app = await ccm.start(
      "https://cdn.jsdelivr.net/gh/ccmjs/slidecast@v1.1.0/ccm.slidecast-1.1.0.min.mjs#sha384-l8tLDoXszYpItIkbcjxiPlKEZXu3yk97ctZD3D9liLWYZqwUsoQjVwI6K++JA9b/",
      {},
      document.querySelector("#slidecast")
  );
</script>
```

Place this example inside the document body. It uses the default configuration: the demo PDF, English labels, no autoplay and no comment placeholders. Set `pdf` in the configuration to display your own document. No local copy of the component or its libraries is needed.

The framework script uses the browser's `integrity` attribute; ccmjs verifies the component using the `#sha384-…` URL fragment. These hashes cover the framework and component files, respectively, not every resource loaded by the component. The component hash covers the exact published main file, including its source map comment. Update the URL and hash together when changing versions.

The component in the CDN example is pinned to `v1.1.0`. The repository prepares `v1.2.0`, which adds volume/mute retention and the user-facing autoplay switch and removes the separate speed readout. Use the local module from Quick start until that release is published; then update the component URL and integrity hash together.

## Custom sequences

```js
const app = await ccm.start('./ccm.slidecast.mjs', {
  pdf: './presentation.pdf',
  viewer: { download: false, textSelection: true },
  comments: true,
  ignore: {
    slides: [
      { page: 1 },
      { page: 2, audio: './audio/02.mp3', description: '<h2>A closer look</h2><p>Additional explanation for this slide.</p>' },
      { app: ['ccm.start', './quiz/ccm.quiz.mjs', { /* Quiz configuration */ }] },
      { page: 3 },
      { image: './images/extra.jpg', description: 'An additional image slide' }
    ]
  }
}, document.querySelector('#slidecast'));
```

Replace the example PDF, media and Quiz URLs with your own resources.

`ignore.slides` defines the complete sequence. Each entry contains exactly one of `page` (a PDF page, starting at 1), `image` (an image URL), or `app` (a `ccm.start` dependency). `audio`, `description`, and `title` as alternative text for images are optional. An empty sequence generates entries for all PDF pages. A sequence containing only images and apps does not need a PDF.

The `ignore` section prevents ccmjs from resolving dependencies during initialization. App dependencies therefore remain serializable in state and start only when their step is first visited. Embedded apps retain their instances and inputs when revisited. Configuration and state should contain JSON-compatible data; modules can be loaded through `ccm.load` within an app dependency.

Descriptions support `h2`–`h4`, `p`, `br`, `strong`, `em`, `b`, `i`, `ul`, `ol`, `li`, `blockquote`, `code`, `pre` and `a`. Other elements, including their contents, are removed. Attributes are stripped except for safe link destinations. Media URLs support HTTP(S) and Blob URLs. Relative media URLs resolve against the embedding page. Cross-origin PDFs require appropriate CORS headers.

Audio uses native browser controls and pauses when the step changes. By default, playback starts on user interaction. The chosen playback speed, volume and mute setting are retained across slides, silent steps, apps and restarts of the same instance, including changes made through the native player. These listener preferences are separate from content state; a new instance or page reload starts at `1×`, full player volume and unmuted. Retaining the volume setting does not normalize recordings made at different loudness levels.

`comments: true` displays a placeholder beneath each slide for the future commenting component; app steps have no comment area. Comments are not stored yet.

## Autoplay

The **Autoplay** checkbox above the content lets learners enable or disable automatic playback at any time, including while a slide is loading. Press **A** with focus inside the Slidecast to toggle the same setting; the shortcut is shown beside the checkbox. `config.autoplay` supplies the initial choice: disabled by default and enabled in the repository's demo configuration. The switch updates the instance's `autoplay` value, retaining the choice across slide changes and restarts of that instance. A new instance or page reload uses the configuration again.

Enabling autoplay starts or resumes the current slide's audio. With autoplay enabled, audio starts when entering a slide; after it ends, the next step opens after `autoplayDelay` milliseconds (default: `1000`, or one second). Disabling autoplay immediately pauses the current slide's audio and cancels pending automatic navigation. The native play button remains available for manual playback.

```js
{ autoplay: true, autoplayDelay: 1000 }
```

Browsers may block the initial automatic playback. In that case, start playback through the audio player; automatic advancement still works after it ends. Slides without audio and app steps are not automatically left or skipped. Playback stops advancing at the last step. Manual navigation, restart, destruction, replaying or seeking cancels a pending transition. With autoplay disabled, the current slide remains visible after its audio ends.

## Navigation and audio shortcuts

Enter a number in the **Step** field and press **Enter** to jump directly to that position. Steps start at `1` and include embedded apps and image slides. For PDF slides, the original PDF page number is also shown next to the total step count. Invalid, empty or fractional numbers leave the current step unchanged and display a message.

With focus inside the Slidecast (click its content or use Tab), these shortcuts are available:

| Key | Action |
| --- | --- |
| Left / Right arrow | Previous / next step, including embedded apps. |
| `A` | Toggle autoplay, including on silent steps and while loading. |
| `+` / `-` | Increase / decrease audio speed by `0.25×`, from `0.25×` to `4×`. |
| `,` / `.` | Seek audio backward / forward by ten seconds, bounded by the start and end. |

Audio shortcuts also work with focus on the slide's native audio player. Seeking preserves its paused or playing state and is available once the recording's duration has loaded. Steps without audio ignore audio shortcuts. Arrow navigation stops at the sequence boundaries and leaves native media controls' arrow-key behavior intact.

Input fields, editable content and embedded apps retain their own keys, including controls inside nested shadow roots. The Autoplay checkbox itself accepts `A` as well as its native Space key. To navigate away from an app using arrow keys, first focus the Slidecast navigation. Held keys and shortcuts with Ctrl, Alt or Command are ignored. Shift is accepted only for `+`, which requires it on some keyboard layouts. Shortcuts affect only the focused Slidecast instance.

## State and API

Example state:

```js
app.state = {
  pdf: './presentation.pdf',
  index: 0, // Current step, starting at 0; app steps count too.
  slides: [{ page: 1 }, { app: ['ccm.start', './quiz/ccm.quiz.mjs', {}] }]
};
```

- `await app.goTo(index)`: Navigate to a step. Invalid indices are rejected.
- `app.getValue()`: Return a deep, serializable copy of state.
- `await app.start()`: Rebuild from `pdf`, `viewer` and `ignore.slides`, releasing previous child instances.
- `await app.destroy()`: Stop audio, release child instances and clear the interface. Restarting afterward is supported.
- `app.gui.busy`: Interaction lock during an action; concurrent requests are ignored.
- `app.error`: Most recent action error, also shown in the interface.
- `extensions`: Functions receiving `{ app, type }`, called sequentially. Events: `init`, `ready`, `before-start`, `render`, `start`, `change`, `error`, `destroy`. Do not await `destroy()` from an extension inside an active action.

Restore a snapshot using `pdf: saved.pdf`, `ignore: { slides: saved.slides }`, then call `await app.goTo(saved.index)` after starting. Embedded apps' internal state is not part of the snapshot. To modify the sequence, update `ignore.slides` and restart. No authoring editor, upload service or persistence service is included.

Slidecast navigation controls the complete sequence. The PDF Viewer uses `navigation: false` to disable its page buttons, page input and arrow-key navigation. Internal PDF links are routed through Slidecast navigation so audio, descriptions and comment placeholders follow the target slide. Links jump directly to a PDF page and may skip app steps. If a page occurs multiple times, the current occurrence is preferred; otherwise, the first matching entry is used. If the target page is absent, a message is displayed and the current step remains unchanged. External links open a new tab. Set `viewer: { links: false }` to disable all PDF links. Zoom and optional download remain available. Slide changes wait for ongoing PDF Viewer actions so the displayed page and accompanying content stay synchronized.

Apps with background activity should implement a `destroy()` method. Leaving an app step detaches its interface but retains its instance until the Slidecast is restarted or destroyed.
