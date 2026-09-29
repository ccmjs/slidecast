/**
 * PDF slidecasts with optional audio, descriptions and interleaved ccmjs apps.
 *
 * Reading guide:
 * - config defines input; start() clones it into a serializable state snapshot.
 * - run() gates slidecast actions; show() coordinates the viewer and slide content.
 * - withIdleViewer() bridges the PDF viewer's independent interaction lock.
 * - release()/destroy() own child instances, audio and pending autoplay timers.
 *
 * One PDF viewer is reused throughout a session. Embedded apps are started lazily
 * and cached by sequence index. Neither child instances nor DOM nodes enter state.
 * PDF page numbers start at 1; sequence indices start at 0 and include app steps.
 *
 * @author André Kless <andre.kless@web.de>
 * @copyright 2026 André Kless
 * @license MIT
 * @version 1.0.0
 */

export const component = {
  name: "slidecast",
  ccm: "././libs/framework/ccm-28.0.0.min.js",
  config: {
    /** Component factory, not a started instance; start() supplies its host and config.
     * The pinned viewer loads its own library/style resources from versioned CDN URLs.
     */
    pdf_viewer: ["ccm.component", "././libs/pdf_viewer/ccm.pdf_viewer-1.0.0.min.mjs"],
    /** ././ paths are local before the publishing pipeline rewrites them. */
    css: ["ccm.load", "././resources/styles.css"],
    /** Input PDF; only needed for automatic sequences or entries containing page. */
    pdf: "https://cdn.jsdelivr.net/gh/ccmjs/pdf_viewer@v1.0.0/resources/demo.pdf",
    /** PDF-viewer options. start() always owns pdf, parent, navigation and onLink. */
    viewer: {
      navigation: false, links: true, download: true,
      labels: {
        viewer: "PDF Viewer", previous: "Previous", next: "Next", page: "Page", of: "of",
        zoomOut: "Zoom out", zoomIn: "Zoom in", fit: "Fit to width", download: "Download",
        loading: "Loading PDF …", rendering: "Loading page …", missing: "No PDF URL provided.",
        error: "The PDF could not be loaded or displayed.",
        password: "Please enter the password for this PDF.",
        passwordIncorrect: "Incorrect password. Please try again.",
        passwordLabel: "Password", unlock: "Open PDF", cancel: "Cancel",
        passwordCancelled: "Opening the PDF was cancelled.",
        invalidPage: "Please enter a valid page number.", link: "Link in PDF",
      },
    },
    /** ccm skips dependency resolution inside ignore, preserving lazy app definitions.
     * An empty slides array generates one entry per PDF page. A nonempty array is
     * the complete sequence, not a set of overrides for automatically generated pages.
     */
    ignore: { slides: [] },
    /** Show a per-slide placeholder only; no commenting service is implemented yet. */
    comments: false,
    /** Try playing slide audio on entry and advance after it finishes. */
    autoplay: false,
    /** Pause after audio ends, in milliseconds (0–2147483647); no timer on silent slides. */
    autoplayDelay: 1000,
    labels: {
      navigation: 'Slidecast navigation', previous: 'Previous', next: 'Next',
      step: 'Step', of: 'of', slide: 'Slide', audio: 'Slide audio',
      comments: 'Slide comments', commentsPlaceholder: 'Commenting will be added later.',
      missingLinkTarget: 'The linked PDF page is not part of this slidecast.',
      error: 'The slidecast could not be displayed: ', pdfNotOpened: 'The PDF was not opened.',
    },
    /** Functions (or ccm.load-resolved functions) invoked in order with { app, type }.
     * Lifecycle events: init, ready, before-start, render, start, change, error, destroy.
     */
    extensions: [],
  },
  Instance: function () {
    /** PDF-viewer child instance, reused across PDF slides and released on restart or destroy. */
    let viewer;

    /** Last accepted viewer.run() promise; awaited before submitting another viewer action. */
    let viewerAction;

    /** Persistent DOM references created by build(); cleared after successful destruction. */
    let ui;

    /** Current slidecast action promise; destroy() waits for it before final cleanup. */
    let active;

    /** Prevent new actions while destroy() waits for pending work and releases resources. */
    let closing = false;

    /** Single delayed autoplay transition, cancelled on replay, seek or teardown. */
    let advanceTimer;

    /** Sequence index -> started child instance. Repeated app entries stay independent. */
    const apps = new Map();

    /** @type {SlidecastState|null} Null before initialization and after successful destruction. */
    this.state = null;

    /** Slidecast interaction lock; PDF zoom/rendering has a separate child lock. */
    this.gui = { busy: false };

    /** Last action failure, cleared when the next action is accepted. */
    this.error = null;

    /** Forward the ccm initialization lifecycle to extensions. */
    this.init = async () => this.emit("init");

    /** Forward the ccm ready lifecycle to extensions. */
    this.ready = async () => this.emit("ready");

    /**
     * Restart from config, disposing the previous session first. PDF-only input expands
     * to all pages; image/app-only sequences do not instantiate a PDF viewer.
     * On success: before-start -> render -> start. Config is cloned into state, so
     * editing a getValue() snapshot does not change the running sequence.
     * A PDF password prompt keeps this pending; cancellation resolves with null state.
     * @returns {Promise<void>} Resolves after render/start extensions; rejects on failure.
     */
    this.start = () => run(async () => {
      await this.emit("before-start");
      await release();
      this.state = null;
      build();
      if (!Number.isFinite(this.autoplayDelay) || this.autoplayDelay < 0 || this.autoplayDelay > 2147483647)
        throw new RangeError("autoplayDelay must be a non-negative timer duration in milliseconds.");
      const input = structuredClone(this.ignore?.slides || []);
      if (!Array.isArray(input)) throw new TypeError("ignore.slides must be an array.");
      if (input.length === 0 || input.some(slide => slide?.page !== undefined)) {
        viewer = await this.pdf_viewer.instance({ ...this.viewer, pdf: this.pdf, navigation: false, parent: this,
          // The viewer invokes onLink outside its own lock. Map the resolved PDF page
          // to a sequence position so links update audio/prose just like other navigation.
          onLink: async ({ page }) => {
            if (closing || this.gui.busy || !this.state) return;
            // Prefer the current occurrence, otherwise the first occurrence in the sequence.
            const index = this.state.slides[this.state.index].page === page ? this.state.index
              : this.state.slides.findIndex(slide => slide.page === page);
            if (index < 0) { ui.status.textContent = this.labels.missingLinkTarget; return; }
            await this.goTo(index);
            ui?.root.focus({ preventScroll: true });
          }, }, ui.pdf);
        // Adapt the pinned viewer's public run() method without editing the dependency.
        // Install before start(), so initial rendering and deferred resizes are tracked too.
        // Keep its return value/locking semantics; an ignored call resolves immediately
        // and must never replace the promise of the actual operation still in progress.
        viewerAction = null;
        if (typeof viewer.run === "function") {
          const run = viewer.run.bind(viewer);
          viewer.run = action => {
            const busy = viewer.gui.busy;
            const pending = run(action);
            if (!busy) viewerAction = pending;
            return pending;
          };
        }
        await viewer.start();
        if (!viewer.state) { ui.status.textContent = this.labels.pdfNotOpened; return; }
      }
      const slides = input.length ? input : Array.from({ length: viewer.state.pages }, (_, i) => ({ page: i + 1 }));
      validate(slides);
      this.state = { pdf: this.pdf, index: 0, slides };
      await show(0);
      await this.emit("start");
    });

    /**
     * Await extensions in config order; the first rejection stops further callbacks.
     * Events emitted by run() are inside its lock. Navigation from such a callback
     * is ignored, and awaiting destroy() there would wait on the callback itself.
     * @param {string} type Lifecycle or action event name.
     * @returns {Promise<void>}
     */
    this.emit = async type => {
      for (const extension of [].concat(this.extensions || []))
        if (extension) await extension({ app: this, type });
    };

    /**
     * Navigate within the mixed sequence. Bounds/type errors reject; the current step
     * and calls without state are no-ops. Successful changes emit render, then change.
     * If rendering fails, try to restore the previous step and preserve the original
     * error even if that restoration fails too. Audio restarts from the beginning.
     * @param {number} index Zero-based integer; app steps count as entries.
     * @returns {Promise<void>} Resolves once the accepted navigation completes.
     */
    this.goTo = index => run(async () => {
      if (!this.state) return;
      if (!Number.isInteger(index) || index < 0 || index >= this.state.slides.length) throw new RangeError("Invalid step.");
      if (index === this.state.index) return;
      const previous = this.state.index;
      try { await show(index); }
      catch (error) { await show(previous).catch(() => {}); throw error; }
      await this.emit("change");
    });

    /**
     * Return a deep snapshot without DOM nodes, running apps or their internal state.
     * Restore via pdf/ignore.slides, await start(), then goTo(snapshot.index).
     * @returns {SlidecastState|null}
     */
    this.getValue = () => structuredClone(this.state);

    /**
     * Stop autoplay immediately, block new actions and release the current session.
     * Destroy the known PDF viewer first to settle any pending password prompt, then
     * wait for the slidecast action. A viewer created during that wait is handled by
     * release(). Successful cleanup empties state/DOM and emits destroy; restart is allowed.
     * Do not await this from an extension running inside an active slidecast action.
     * @returns {Promise<void>} Rejects if child cleanup or the destroy extension fails.
     */
    this.destroy = async () => {
      closing = true;
      pause();
      try {
        // Cancel a pending PDF password prompt before waiting for slidecast.start().
        const pendingViewer = viewer;
        await pendingViewer?.destroy();
        await active?.catch(() => {});
        if (viewer === pendingViewer) {
          pendingViewer?.host?.remove();
          if (pendingViewer && this.children) delete this.children[pendingViewer.index];
          viewer = null;
        }
        await release();
        this.state = null;
        this.element.replaceChildren();
        ui = null;
        await this.emit("destroy");
      } finally { closing = false; }
    };

    /**
     * Accept one slidecast action at a time; concurrent requests resolve as no-ops.
     * Errors are stored, displayed, emitted and rethrown. DOM/timer handlers consume
     * those rejections because reporting has already happened here.
     * The lock includes extension callbacks and is released even when they reject.
     * @param {Function} action Async action body.
     * @returns {Promise<*>} Action result, or undefined for an ignored request.
     */
    const run = action => {
      if (closing || this.gui.busy) return Promise.resolve();
      this.gui.busy = true;
      controls();
      active = (async () => {
        try {
          this.error = null;
          if (ui) ui.status.textContent = "";
          return await action();
        } catch (error) {
          this.error = error;
          if (ui) ui.status.textContent = this.labels.error + error.message;
          await this.emit("error");
          throw error;
        } finally { this.gui.busy = false; controls(); }
      })();
      return active;
    };

    /** Apply lock and sequence bounds to navigation; tolerate absent UI during teardown. */
    const controls = () => {
      if (!ui) return;
      const disabled = this.gui.busy || !this.state;
      ui.previous.disabled = disabled || this.state.index === 0;
      ui.next.disabled = disabled || this.state.index === this.state.slides.length - 1;
      ui.root.setAttribute("aria-busy", String(this.gui.busy));
    };

    /**
     * Dispose owned children on restart/teardown. allSettled ensures every child is
     * visited even if one destroy() rejects. Hosts and ccm parent references are
     * removed in finally; the first cleanup failure is rethrown after all attempts.
     * UI/state reset and lifecycle events belong to the caller.
     */
    const release = async () => {
      pause();
      const children = [...apps.values()];
      apps.clear();
      if (viewer) children.push(viewer);
      viewer = null;
      const results = await Promise.allSettled(children.map(async child => {
        try { await child.destroy?.(); }
        finally { child.host?.remove(); if (this.children) delete this.children[child.index]; }
      }));
      const failed = results.find(result => result.status === "rejected");
      if (failed) throw failed.reason;
    };

    /** Stop slide-owned audio and delayed navigation; embedded apps own their media. */
    const pause = () => {
      cancelAdvance();
      ui?.details.querySelectorAll("audio").forEach(audio => audio.pause());
    };

    /** Cancel the pending autoplay transition, if any. */
    const cancelAdvance = () => { clearTimeout(advanceTimer); advanceTimer = undefined; };

    /** Rebuild the persistent shell; show() replaces only the active step's content. */
    const build = () => {
      const root = node("section", "slidecast");
      root.setAttribute("aria-label", "Slidecast");
      root.tabIndex = 0;
      root.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight");
      const nav = node("nav", "slidecast-nav");
      nav.setAttribute("aria-label", this.labels.navigation);
      const button = (label, delta) => {
        const el = node("button", "", label);
        el.type = "button";
        el.addEventListener("click", () => this.goTo(this.state.index + delta).catch(() => {}));
        return el;
      };
      const previous = button(this.labels.previous, -1), next = button(this.labels.next, 1);
      const progress = node("output");
      progress.setAttribute("aria-live", "polite");
      nav.append(previous, progress, next);
      const status = node("p", "slidecast-status");
      status.setAttribute("role", "status");
      const pdf = node("div", "slidecast-pdf"), image = node("img", "slidecast-image");
      const embedded = node("div", "slidecast-app"), details = node("div", "slidecast-details");
      root.addEventListener("keydown", event => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key) || event.defaultPrevented ||
            event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        // composedPath sees inputs inside the PDF viewer's shadow root as well.
        // Embedded apps own their keyboard events, including their shadow DOM.
        const path = event.composedPath();
        if (path.includes(embedded) || path.some(target => target instanceof Element &&
            (target.isContentEditable || target.matches("input, textarea, select, audio, video, [role='textbox'], [role='slider'], [role='spinbutton']")))) return;
        if (!this.state) return;
        event.preventDefault();
        if (this.gui.busy || event.repeat) return;
        const index = this.state.index + (event.key === "ArrowRight" ? 1 : -1);
        if (index < 0 || index >= this.state.slides.length) return;
        // Focus survives hiding the PDF or replacing the current slide's content.
        root.focus({ preventScroll: true });
        this.goTo(index).catch(() => {});
      });
      root.append(nav, status, pdf, image, embedded, details);
      this.element.replaceChildren(root);
      ui = { root, previous, next, progress, status, pdf, image, embedded, details };
      image.hidden = embedded.hidden = true;
      controls();
    };

    /** Build a DOM node using plain text; only description() handles HTML input. */
    const node = (tag, className, text) => {
      const el = document.createElement(tag);
      if (className) el.className = className;
      if (text !== undefined) el.textContent = text;
      return el;
    };

    /**
     * Validate the complete sequence before showing it. PDF bounds require a loaded
     * viewer; this checks metadata, not remote media availability or app validity.
     * @param {Slide[]} slides Cloned config entries or generated PDF entries.
     * @throws {TypeError|RangeError|Error} Invalid entry, URL, page or empty sequence.
     */
    const validate = slides => {
      if (!Array.isArray(slides) || !slides.length) throw new Error("No slides available.");
      for (const slide of slides) {
        if (!slide || typeof slide !== "object") throw new TypeError("Invalid slide entry.");
        if ([slide.page !== undefined, slide.image !== undefined, slide.app !== undefined].filter(Boolean).length !== 1)
          throw new TypeError("Each entry must specify exactly one of page, image or app.");
        if (slide.page !== undefined && (!Number.isInteger(slide.page) || slide.page < 1 || slide.page > (viewer?.state?.pages || 0)))
          throw new RangeError("PDF page is outside the document.");
        if (slide.app !== undefined && (!Array.isArray(slide.app) || slide.app[0] !== "ccm.start"))
          throw new TypeError("Apps must be a ccm.start dependency.");
        for (const key of ["image", "audio"]) if (slide[key] !== undefined) mediaURL(slide[key]);
        if (slide.description !== undefined && typeof slide.description !== "string") throw new TypeError("Description must be a string.");
      }
    };

    /** Resolve against the embedding document, allowing only HTTP(S) and Blob URLs. */
    const mediaURL = value => {
      if (typeof value !== "string" || !value.trim()) throw new TypeError("Empty media URL.");
      const url = new URL(value, document.baseURI);
      if (!["http:", "https:", "blob:"].includes(url.protocol)) throw new TypeError("Invalid media URL.");
      return url.href;
    };

    /**
     * Render one validated entry under the caller's action lock. Reuse the PDF viewer
     * or a cached app, rebuild audio/prose/comments, then commit index and emit render.
     * PDF rendering and child-app start are awaited; image/audio downloads are not.
     * A failure can leave partial DOM changes; goTo() attempts to restore the old step.
     * @param {number} index Valid zero-based position in state.slides.
     */
    const show = async index => {
      const slide = this.state.slides[index];
      pause();
      // Restore the viewer's measurable layout before fitting a PDF page after an app/image.
      ui.pdf.hidden = slide.page === undefined;
      if (slide.page !== undefined) {
        await withIdleViewer(() => viewer.goToPage(slide.page));
        if (closing) return;
        if (viewer.state.zoom === "page-width") await withIdleViewer(() => viewer.setZoom("page-width"));
        if (closing) return;
      }
      let app;
      if (slide.app) {
        app = apps.get(index);
        if (!app) {
          ui.embedded.hidden = false;
          const host = node("div");
          ui.embedded.replaceChildren(host);
          // Resolve a clone so ccm can inject parent/config without mutating the snapshot.
          const [op, component, config = {}] = structuredClone(slide.app);
          app = await this.ccm.helper.solveDependency([op, component, config, host], this);
          apps.set(index, app);
        }
      }
      ui.image.hidden = !slide.image;
      if (slide.image) { ui.image.src = mediaURL(slide.image); ui.image.alt = slide.title || `${this.labels.slide} ${index + 1}`; }
      else ui.image.removeAttribute("src");
      ui.embedded.hidden = !app;
      // Move the host, not its ShadowRoot; detached cached apps retain their inputs.
      ui.embedded.replaceChildren(...(app ? [app.host] : []));
      ui.details.replaceChildren();
      if (slide.audio) {
        const audio = node("audio");
        audio.controls = true;
        audio.preload = "metadata";
        audio.src = mediaURL(slide.audio);
        audio.setAttribute("aria-label", this.labels.audio);
        ui.details.append(audio);
        if (!slide.app) prepareAutoplay(audio, index);
      }
      if (slide.description) {
        const prose = node("div", "slidecast-description");
        prose.append(description(slide.description));
        ui.details.append(prose);
      }
      if (this.comments && !slide.app) {
        const comment = node("section", "slidecast-comments", this.labels.commentsPlaceholder);
        comment.dataset.slide = String(slide.page || index + 1);
        comment.setAttribute("aria-label", this.labels.comments);
        ui.details.append(comment);
      }
      this.state.index = index;
      ui.progress.textContent = `${this.labels.step} ${index + 1} ${this.labels.of} ${this.state.slides.length}` + (slide.page ? ` · ${this.labels.slide} ${slide.page}` : "");
      await this.emit("render");
      if (this.autoplay && !slide.app && !closing) {
        // Browsers may require a user gesture; native controls remain available.
        const audio = ui.details.querySelector("audio");
        if (audio) void audio.play().catch(() => {});
      }
    };

    /**
     * Bridge the PDF viewer's independent lock: busy goToPage()/setZoom() calls are
     * ignored by the viewer, so awaiting their return alone would not ensure a render.
     * Wait for the tracked action, then invoke immediately without yielding between
     * checking idle and calling the method. Loop because a deferred resize can start
     * another viewer action while we wait. A prior failure must not block recovery.
     * During destruction skip new work; show() checks closing after each await.
     */
    const withIdleViewer = async action => {
      while (viewer?.gui?.busy && viewerAction) await viewerAction.catch(() => {});
      if (!closing) await action();
    };

    /**
     * Bind end-of-audio navigation to this exact render's audio element and index.
     * Checking both rejects stale events after returning to the same sequence entry.
     * Replay/seeking cancels the delay; a pending callback rechecks autoplay and ended.
     * Only show() initiates playback; this helper merely schedules the next step.
     * @param {HTMLAudioElement} audio Current slide's audio element.
     * @param {number} index Zero-based sequence position.
     */
    const prepareAutoplay = (audio, index) => {
      const isCurrent = () => !closing && this.autoplay && this.state?.index === index &&
        ui?.details.querySelector("audio") === audio;
      audio.addEventListener("play", cancelAdvance);
      audio.addEventListener("seeking", cancelAdvance);
      audio.addEventListener("ended", () => {
        cancelAdvance();
        if (!isCurrent() || index >= this.state.slides.length - 1) return;
        const advance = () => {
          advanceTimer = undefined;
          if (!isCurrent() || !audio.ended) return;
          // An extension may still be finishing the render action for a very short audio.
          if (this.gui.busy) { advanceTimer = setTimeout(advance, 100); return; }
          this.goTo(index + 1).catch(() => {});
        };
        advanceTimer = setTimeout(advance, this.autoplayDelay);
      });
    };

    /**
     * Parse descriptions in an inert template and return the cleaned fragment.
     * Unsupported elements are removed with their contents, not unwrapped. Attributes
     * are stripped before restoring safe anchor hrefs; relative links use document.baseURI.
     * Malformed link URLs reject the action rather than inserting unvalidated content.
     * @param {string} html Author-provided description.
     * @returns {DocumentFragment}
     */
    const description = html => {
      const template = document.createElement("template");
      template.innerHTML = html;
      const allowed = new Set(["H2", "H3", "H4", "P", "BR", "STRONG", "EM", "B", "I", "UL", "OL", "LI", "BLOCKQUOTE", "CODE", "PRE", "A"]);
      const clean = parent => {
        for (const child of [...parent.childNodes]) {
          if (child.nodeType === 3) continue;
          if (child.nodeType !== 1 || !allowed.has(child.tagName)) { child.remove(); continue; }
          const href = child.getAttribute("href");
          for (const attribute of [...child.attributes]) child.removeAttribute(attribute.name);
          if (child.tagName === "A" && href) {
            const url = new URL(href, document.baseURI);
            if (["http:", "https:", "mailto:"].includes(url.protocol)) { child.href = url.href; child.rel = "noopener noreferrer"; }
          }
          clean(child);
        }
      };
      clean(template.content);
      return template.content;
    };
  },
};

/**
 * JSON-compatible input entry. Supply exactly one of page, image or app.
 * Audio/description are optional; app steps never advance automatically.
 * @typedef {Object} Slide
 * @property {number} [page] One-based page in the configured PDF.
 * @property {string} [image] Image URL instead of a PDF page.
 * @property {Array} [app] Unresolved ["ccm.start", componentURL, config?] dependency.
 * @property {string} [audio] Audio URL; rendered with native controls.
 * @property {string} [description] HTML prose filtered through an allowlist.
 * @property {string} [title] Alternative text for image slides.
 */

/**
 * Snapshot of the current sequence, independent of config and child-app state.
 * @typedef {Object} SlidecastState
 * @property {string} pdf Configured PDF URL (also retained for image-only sequences).
 * @property {number} index Zero-based current position in slides.
 * @property {Slide[]} slides Ordered PDF, image and app entries.
 */
