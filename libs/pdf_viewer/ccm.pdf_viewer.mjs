/**
 * Single-page PDF viewer with optional links, text selection and download.
 *
 * @author André Kless <andre.kless@web.de>
 * @copyright 2026 André Kless
 * @license MIT
 */
export const component = {
  name: "pdf_viewer",
  ccm: "././libs/framework/ccm.js",
  config: {
    /** PDF.js display API; keep it on the same version as the worker and auxiliary resources. */
    pdfjs: ["ccm.load", "././libs/pdfjs/pdf.min.mjs"],
    css: ["ccm.load", "././libs/pdfjs/pdf_viewer.css", "././resources/styles.css"],
    worker: "././libs/pdfjs/pdf.worker.min.mjs",
    /** Character maps, fallback fonts and image codecs, loaded by PDF.js as needed. */
    cMaps: "././libs/pdfjs/cmaps/",
    fonts: "././libs/pdfjs/standard_fonts/",
    wasm: "././libs/pdfjs/wasm/",
    /** PDF URL, relative to the embedding page or absolute (requires CORS across origins). */
    pdf: "././resources/demo.pdf",
    /** Optional initial PDF password; otherwise ask in the viewer when needed. */
    password: "",
    /** Remember successful form entries per PDF URL in sessionStorage (same tab/origin). */
    rememberPassword: true,
    /** Enable existing internal and external PDF links. */
    links: true,
    /** Optional async ({ app, page }) handler for internal PDF links; owns navigation when set. */
    onLink: null,
    /** Offer downloading; this is not copy protection. */
    download: true,
    /** Select and copy existing PDF text (no OCR). */
    textSelection: true,
    /** Initial page, counted from 1; clamped to the document's page range. */
    page: 1,
    /** Show page controls and enable arrow-key navigation (embedding apps can own navigation). */
    navigation: true,
    /** "page-width" or a number from 0.25 to 4 (1 = 100%). */
    zoom: "page-width",
    /** Suggested download filename. */
    filename: "document.pdf",
    labels: {
      viewer: "PDF-Viewer", previous: "Zurück", next: "Weiter", page: "Seite", of: "von",
      zoomOut: "Verkleinern", zoomIn: "Vergrößern", fit: "Breite anpassen", download: "Herunterladen",
      loading: "PDF wird geladen …", rendering: "Seite wird geladen …", missing: "Keine PDF-URL angegeben.",
      error: "Das PDF konnte nicht geladen oder angezeigt werden.",
      password: "Bitte das Passwort für dieses PDF eingeben.",
      passwordIncorrect: "Das Passwort ist falsch. Bitte erneut versuchen.",
      passwordLabel: "Passwort", unlock: "PDF öffnen", cancel: "Abbrechen",
      passwordCancelled: "Das Öffnen des PDFs wurde abgebrochen.",
      invalidPage: "Bitte eine gültige Seitenzahl eingeben.", link: "Link im PDF",
    },
    /** Functions or `["ccm.load", "./extensions.mjs#name"]`, called sequentially with `{ app, type }`. */
    extensions: [],
  },
  Instance: function () {
    /** Loaded PDF.js document proxy, distinct from the browser DOM document. */
    let document;

    /** PDF.js loading task; owns the worker and is destroyed when releasing the document. */
    let loadingTask;

    /** Watches the viewport width to update fit-to-width rendering. */
    let observer;

    /** Current action promise, awaited by `destroy()` before releasing resources. */
    let active;

    /** Persistent control and viewport DOM references, rebuilt by `buildUI()`. */
    let ui;

    /** Records a resize during an action so it can be processed after the busy lock is released. */
    let resizePending = false;

    /** Prevents new actions while `destroy()` waits for active work and releases resources. */
    let closing = false;

    /** Cancels the pending PDF.js password request; cleared when the prompt is removed. */
    let cancelPassword;

    /** Currently displayed password form, removed after submission, cancellation or cleanup. */
    let passwordForm;

    /** Distinguishes an intentional password cancellation from a document-loading failure. */
    let passwordCancelled = false;

    /** Blob URL -> revocation timer; `release()` also revokes outstanding downloads. */
    const downloads = new Map();

    /** @type {{page: number, pages: number, zoom: number|string, scale: number}|null}
     * One-based page numbers; `zoom` is the requested mode, `scale` the effective numeric zoom.
     */
    this.state = null;

    /** Transient interaction lock; a password prompt remains usable while busy. */
    this.gui = { busy: false };

    /** Most recent action error, cleared at the beginning of the next accepted action. */
    this.error = null;

    /** Forward the ccmjs initialization lifecycle to extensions. */
    this.init = async () => this.emit("init");

    /** Forward the ccmjs ready lifecycle to extensions. */
    this.ready = async () => this.emit("ready");

    /**
     * Release the previous document and load the current config. Remains pending during
     * password entry; cancellation resolves without a document and emits cancel, not start.
     * Successful event order: before-start -> loaded -> render -> start.
     * @returns {Promise<void>}
     */
    this.start = () => this.run(async () => {
      await this.emit("before-start");
      await release();
      passwordCancelled = false;
      this.state = null;
      buildUI();
      if (!this.pdf) {
        ui.status.textContent = this.labels.missing;
        await this.emit("start");
        return;
      }
      const url = new URL(this.pdf, window.document.baseURI);
      if (!["http:", "https:", "blob:"].includes(url.protocol)) throw new Error("Unsupported PDF URL protocol.");
      const passwordUrl = new URL(url);
      // Fragments identify a view within the same PDF; query parameters may identify another PDF.
      passwordUrl.hash = "";
      const passwordKey = `ccm.pdf_viewer.password:${passwordUrl.href}`;
      /** Access optional session storage; unavailable storage must not prevent opening the PDF. */
      const storedPassword = (operation, value) => {
        if (!this.rememberPassword) return null;
        try { return window.sessionStorage[operation](passwordKey, value); }
        catch { return null; }
      };
      let enteredPassword;
      this.pdfjs.GlobalWorkerOptions.workerSrc = this.worker;
      ui.status.textContent = this.labels.loading;
      loadingTask = this.pdfjs.getDocument({
        url: url.href, password: this.password || storedPassword("getItem") || undefined,
        cMapUrl: this.cMaps, cMapPacked: true,
        standardFontDataUrl: this.fonts, wasmUrl: this.wasm, isEvalSupported: false,
      });
      loadingTask.onPassword = (updatePassword, reason) => {
        if (reason === this.pdfjs.PasswordResponses.INCORRECT_PASSWORD) {
          enteredPassword = undefined;
          storedPassword("removeItem");
        }
        cancelPassword = () => {
          passwordCancelled = true;
          clearPasswordForm();
          // PDF.js accepts an Error to reject its pending password request.
          updatePassword(new Error("PDF opening cancelled."));
        };
        if (closing) { cancelPassword(); return; }
        showPasswordForm((password) => {
          enteredPassword = password;
          updatePassword(password);
        }, reason);
      };
      try {
        document = await loadingTask.promise;
        // Persist only successful interactive entries, never guesses or configured passwords.
        if (enteredPassword !== undefined) storedPassword("setItem", enteredPassword);
      } catch (error) {
        if (!passwordCancelled) throw error;
        await release();
        ui.status.textContent = this.labels.passwordCancelled;
        await this.emit("cancel");
        return;
      } finally {
        enteredPassword = undefined;
        clearPasswordForm();
      }
      this.state = {
        page: Math.min(document.numPages, Math.max(1, Math.trunc(Number(this.page)) || 1)),
        pages: document.numPages,
        zoom: validZoom(this.zoom),
        scale: 1,
      };
      await this.emit("loaded");
      let lastWidth = ui.viewport.clientWidth;
      // Height changes while swapping pages must not start a resize/render feedback loop.
      observer = new ResizeObserver(() => {
        const width = ui.viewport.clientWidth;
        if (width === lastWidth) return;
        lastWidth = width;
        if (this.gui.busy) resizePending = true;
        else fitAfterResize();
      });
      observer.observe(ui.viewport);
      // Observe before rendering so layout changes during the first page are not missed.
      await render(this.state.page, this.state.zoom);
      await this.emit("start");
    });

    /**
     * Run one action under an interaction lock; overlapping requests resolve without running.
     * Failures update the UI, emit error and reject. Finally always releases the lock and
     * processes a deferred resize. This is a gate, not a queue of navigation requests.
     * @param {Function} action Async work, including its extension events.
     * @returns {Promise<*>} The action result, or undefined when ignored.
     */
    this.run = (action) => {
      if (this.gui.busy || closing) return Promise.resolve();
      this.gui.busy = true;
      updateControls();
      active = (async () => {
        try {
          this.error = null;
          if (ui) ui.status.textContent = "";
          return await action();
        } catch (error) {
          this.error = error;
          if (ui) ui.status.textContent = error.name === "PasswordException" ? this.labels.password : this.labels.error;
          await this.emit("error");
          throw error;
        } finally {
          this.gui.busy = false;
          updateControls();
          if (resizePending && !closing) {
            resizePending = false;
            queueMicrotask(fitAfterResize);
          }
        }
      })();
      return active;
    };

    /**
     * Navigate to a one-based integer page; numeric input strings are accepted.
     * Invalid requests reject without changing the visible page. Same-page requests do nothing.
     * @param {number|string} page Target page number.
     * @returns {Promise<void>}
     */
    this.goToPage = (page) => this.run(async () => {
      if (!document) return;
      page = Number(page);
      if (!Number.isInteger(page) || page < 1 || page > document.numPages)
        throw new RangeError("Page is outside the document.");
      if (page === this.state.page) return;
      await render(page, this.state.zoom);
      await this.emit("page");
    });

    /** @param {number|"page-width"} zoom Numeric zoom (0.25–4) or responsive width fitting.
     * @returns {Promise<void>} Resolves after render and zoom extensions.
     */
    this.setZoom = (zoom) => this.run(async () => {
      if (!document) return;
      await render(this.state.page, validZoom(zoom));
      await this.emit("zoom");
    });

    /** Request a download of the original bytes, retaining encryption; no-op when disabled. */
    this.downloadPdf = () => this.run(async () => {
      if (!this.download || !document) return;
      const bytes = await document.getData();
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = this.filename;
      anchor.hidden = true;
      this.element.append(anchor);
      anchor.click();
      anchor.remove();
      // Revoking immediately can race the browser's consumption of the download URL.
      downloads.set(url, setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 60000));
      await this.emit("download");
    });

    /**
     * Cancel password entry, wait for active work and release resources before removing the host.
     * Restart is supported afterwards. Do not await this from an extension inside an active action:
     * that action would be waiting for its own completion. Session passwords are retained.
     */
    this.destroy = async () => {
      closing = true;
      try {
        cancelPassword?.();
        await active?.catch(() => {});
        await release();
        this.state = null;
        this.element.replaceChildren();
        ui = null;
        await this.emit("destroy");
      } finally { closing = false; }
    };

    /** Await extensions in config order. A rejection aborts the remaining extensions. */
    this.emit = async (type) => {
      for (const extension of [].concat(this.extensions || []))
        if (extension) await extension({ app: this, type });
    };

    /** Dispose document-owned resources; caller owns visible UI/state and lifecycle events. */
    async function release() {
      clearPasswordForm();
      observer?.disconnect();
      observer = null;
      resizePending = false;
      if (loadingTask) await loadingTask.destroy();
      loadingTask = document = null;
      for (const [url, timer] of downloads) { clearTimeout(timer); URL.revokeObjectURL(url); }
      downloads.clear();
    }

    /** Validate explicit zoom without coercion; unlike initial page numbers, zoom is not clamped. */
    function validZoom(zoom) {
      if (zoom === "page-width") return zoom;
      if (!Number.isFinite(zoom) || zoom < 0.25 || zoom > 4) throw new RangeError("Zoom must be page-width or 0.25–4.");
      return zoom;
    }

    /** Consume DOM-handler rejections already reported by run() through the UI and extensions. */
    const handle = (promise) => { promise.catch(() => {}); };

    /** Re-render after resizing only when the current mode follows the available width. */
    const fitAfterResize = () => {
      if (document && this.state?.zoom === "page-width" && !closing) handle(this.setZoom("page-width"));
    };

    /** Build DOM with textContent so labels and PDF-derived strings are never treated as markup. */
    const node = (tag, className, text) => {
      const element = window.document.createElement(tag);
      if (className) element.className = className;
      if (text !== undefined) element.textContent = text;
      return element;
    };

    /** Forget prompt controls/callbacks; does not itself settle the PDF.js password request. */
    const clearPasswordForm = () => {
      passwordForm?.remove();
      passwordForm = null;
      cancelPassword = null;
    };

    /** Resume the existing loading task directly: run() is still locked by start(). */
    const showPasswordForm = (updatePassword, reason) => {
      passwordForm?.remove();
      const form = node("form", "password-form");
      passwordForm = form;
      ui.status.textContent = reason === this.pdfjs.PasswordResponses.INCORRECT_PASSWORD
        ? this.labels.passwordIncorrect : this.labels.password;
      // The document is still loading, but the password controls must remain accessible.
      ui.root.setAttribute("aria-busy", "false");
      const label = node("label", "", this.labels.passwordLabel + " ");
      const input = node("input");
      input.type = "password";
      input.autocomplete = "off";
      input.required = true;
      label.append(input);
      const submit = node("button", "", this.labels.unlock);
      submit.type = "submit";
      const cancel = node("button", "", this.labels.cancel);
      cancel.type = "button";
      cancel.addEventListener("click", () => cancelPassword?.());
      form.append(label, submit, cancel);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!input.checkValidity()) return;
        const password = input.value;
        input.value = "";
        clearPasswordForm();
        ui.status.textContent = this.labels.loading;
        ui.root.setAttribute("aria-busy", "true");
        updatePassword(password);
      });
      ui.viewport.before(form);
      input.focus();
    };

    /** Rebuild persistent controls on start; render() subsequently replaces only viewport content. */
    const buildUI = () => {
      const root = node("section", "pdf-viewer");
      root.setAttribute("aria-label", this.labels.viewer);
      const toolbar = node("div", "toolbar");
      /** Append a toolbar button whose action uses the shared error-reporting path. */
      const button = (label, action) => {
        const element = node("button", "", label);
        element.type = "button";
        element.addEventListener("click", () => handle(action()));
        toolbar.append(element);
        return element;
      };
      const previous = button(this.labels.previous, () => this.goToPage(this.state.page - 1));
      const form = node("form", "page-form");
      const label = node("label", "", this.labels.page + " ");
      const input = node("input");
      input.type = "number";
      input.min = "1";
      input.step = "1";
      input.required = true;
      input.setAttribute("aria-label", this.labels.page);
      label.append(input);
      const count = node("span");
      form.append(label, count);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!input.checkValidity()) { ui.status.textContent = this.labels.invalidPage; return; }
        handle(this.goToPage(input.value));
      });
      toolbar.append(form);
      const next = button(this.labels.next, () => this.goToPage(this.state.page + 1));
      previous.hidden = form.hidden = next.hidden = !this.navigation;
      const out = button("−", () => this.setZoom(Math.max(0.25, this.state.scale / 1.25)));
      out.setAttribute("aria-label", this.labels.zoomOut);
      const zoom = node("output", "zoom-value");
      toolbar.append(zoom);
      const plus = button("+", () => this.setZoom(Math.min(4, this.state.scale * 1.25)));
      plus.setAttribute("aria-label", this.labels.zoomIn);
      button(this.labels.fit, () => this.setZoom("page-width"));
      if (this.download) button(this.labels.download, () => this.downloadPdf());
      const status = node("p", "status");
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      const viewport = node("div", "viewport");
      viewport.tabIndex = 0;
      viewport.setAttribute("aria-label", this.labels.viewer);
      if (this.navigation) viewport.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight");
      root.addEventListener("keydown", (event) => {
        if (!this.navigation) return;
        if (!["ArrowLeft", "ArrowRight"].includes(event.key) || event.defaultPrevented ||
          event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const target = event.target;
        if (target.isContentEditable || target.closest("input, textarea, select, [role='textbox']")) return;
        if (!this.state) return;
        event.preventDefault();
        if (this.gui.busy || event.repeat) return;
        const page = this.state.page + (event.key === "ArrowRight" ? 1 : -1);
        if (page < 1 || page > this.state.pages) return;
        // Keep keyboard focus on a persistent element when the page/link is replaced.
        viewport.focus({ preventScroll: true });
        handle(this.goToPage(page));
      });
      root.append(toolbar, status, viewport);
      this.element.replaceChildren(root);
      ui = { root, toolbar, previous, next, input, count, zoom, out, plus, viewport, status };
      updateControls();
    };

    /** Combine the action lock with page/zoom boundaries; leave password controls enabled. */
    const updateControls = () => {
      if (!ui) return;
      const disabled = this.gui.busy || !this.state;
      for (const control of ui.toolbar.querySelectorAll("button, input")) control.disabled = disabled;
      ui.root.setAttribute("aria-busy", String(this.gui.busy));
      if (!this.state) return;
      ui.previous.disabled = disabled || this.state.page === 1;
      ui.next.disabled = disabled || this.state.page === this.state.pages;
      ui.out.disabled = disabled || this.state.scale <= 0.25;
      ui.plus.disabled = disabled || this.state.scale >= 4;
      ui.input.value = this.state.page;
      ui.input.max = this.state.pages;
      ui.count.textContent = ` ${this.labels.of} ${this.state.pages}`;
      ui.zoom.textContent = `${Math.round(this.state.scale * 100)} %`;
    };

    /**
     * Build one complete page off-DOM, then commit it and its state together before emitting render.
     * Call only inside run(). A layer failure preserves the previous visible page and state.
     * @param {number} number One-based page number.
     * @param {number|"page-width"} zoom Validated zoom value.
     */
    const render = async (number, zoom) => {
      ui.status.textContent = this.labels.rendering;
      const page = await document.getPage(number);
      // Convert PDF points (72/inch) to CSS pixels (96/inch); 32 matches viewport's 16px side padding.
      const base = page.getViewport({ scale: 96 / 72 });
      const scale = zoom === "page-width"
        ? Math.min(4, Math.max(0.25, (ui.viewport.clientWidth - 32) / base.width)) : zoom;
      const viewport = page.getViewport({ scale: scale * 96 / 72 });
      const sheet = node("div", "pdf-page");
      sheet.style.width = `${viewport.width}px`;
      sheet.style.height = `${viewport.height}px`;
      sheet.style.setProperty("--scale-factor", viewport.scale);
      // Non-default PDF user units must also scale the text overlay, not only the raster canvas.
      sheet.style.setProperty("--total-scale-factor", viewport.scale * viewport.userUnit);
      sheet.setAttribute("aria-label", `${this.labels.page} ${number} ${this.labels.of} ${document.numPages}`);
      const canvas = node("canvas");
      // Cap raster memory, while retaining full CSS dimensions and selectable text.
      const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(16000000 / (viewport.width * viewport.height)));
      canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
      canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      sheet.append(canvas);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport,
        transform: [ratio, 0, 0, ratio, 0, 0], annotationMode: this.pdfjs.AnnotationMode.ENABLE }).promise;
      if (this.textSelection) {
        const container = node("div", "textLayer");
        sheet.append(container);
        await new this.pdfjs.TextLayer({
          textContentSource: await page.getTextContent(), container, viewport,
        }).render();
      }
      if (this.links) {
        // A link-only overlay intentionally omits form widgets, scripts and annotation editing.
        const layer = node("div", "link-layer");
        for (const annotation of await page.getAnnotations({ intent: "display" })) {
          if (annotation.subtype !== "Link") continue;
          const link = node("a", "pdf-link");
          if (annotation.url) {
            const url = new URL(annotation.url, window.document.baseURI);
            if (!["http:", "https:", "mailto:", "tel:"].includes(url.protocol)) continue;
            link.href = url.href;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.setAttribute("aria-label", url.href);
          } else if (annotation.dest || ["NextPage", "PrevPage", "FirstPage", "LastPage"].includes(annotation.action)) {
            link.href = "#";
            link.setAttribute("aria-label", this.labels.link);
            link.addEventListener("click", (event) => {
              event.preventDefault();
              handle(followLink(annotation));
            });
          } else continue;
          const [x1, y1] = viewport.convertToViewportPoint(annotation.rect[0], annotation.rect[1]);
          const [x2, y2] = viewport.convertToViewportPoint(annotation.rect[2], annotation.rect[3]);
          Object.assign(link.style, { left: `${Math.min(x1, x2)}px`, top: `${Math.min(y1, y2)}px`,
            width: `${Math.abs(x2 - x1)}px`, height: `${Math.abs(y2 - y1)}px` });
          layer.append(link);
        }
        sheet.append(layer);
      }
      ui.viewport.replaceChildren(sheet);
      ui.viewport.scrollTo(0, 0);
      Object.assign(this.state, { page: number, zoom, scale });
      ui.status.textContent = "";
      await this.emit("render");
    };

    /** Resolve named/explicit destinations or supported page actions; preserve the user's zoom. */
    const followLink = async (annotation) => {
      const navigation = await this.run(async () => {
        let number;
        if (annotation.dest) {
          const destination = typeof annotation.dest === "string"
            ? await document.getDestination(annotation.dest) : annotation.dest;
          if (!destination) return;
          // PDF destinations use zero-based indices or indirect page references; our API is one-based.
          number = Number.isInteger(destination[0]) ? destination[0] + 1
            : await document.getPageIndex(destination[0]) + 1;
        } else {
          number = { NextPage: this.state.page + 1, PrevPage: this.state.page - 1,
            FirstPage: 1, LastPage: document.numPages }[annotation.action];
        }
        if (!Number.isInteger(number) || number < 1 || number > document.numPages) return;
        if (typeof this.onLink === "function") return { handler: this.onLink, page: number, source: document };
        await render(number, this.state.zoom);
        await this.emit("page");
      });
      // Release the viewer's action lock before the host calls goToPage().
      if (navigation && navigation.source === document && !closing)
        await navigation.handler({ app: this, page: navigation.page });
    };
  },
};
