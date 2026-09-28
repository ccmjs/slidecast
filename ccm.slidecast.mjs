/** PDF slidecasts with optional audio, descriptions and interleaved ccmjs apps. @license MIT */
export const component = {
  name: "slidecast",
  ccm: "././libs/framework/ccm-28.0.0.min.js",
  config: {
    pdf_viewer: ["ccm.component", "././libs/pdf_viewer/ccm.pdf_viewer-1.0.0.min.mjs"],
    css: ["ccm.load", "././resources/styles.css"],
    pdf: "https://cdn.jsdelivr.net/gh/ccmjs/pdf_viewer@v1.0.0/resources/demo.pdf",
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
    // ignore prevents ccm from eagerly starting embedded apps before their step is visible.
    ignore: { slides: [] },
    comments: false,
    /** Try playing slide audio on entry and advance after it finishes. */
    autoplay: false,
    /** Pause after audio ends, in milliseconds. */
    autoplayDelay: 1000,
    labels: {
      navigation: 'Slidecast navigation', previous: 'Previous', next: 'Next',
      step: 'Step', of: 'of', slide: 'Slide', audio: 'Slide audio',
      comments: 'Slide comments', commentsPlaceholder: 'Commenting will be added later.',
      missingLinkTarget: 'The linked PDF page is not part of this slidecast.',
      error: 'The slidecast could not be displayed: ', pdfNotOpened: 'The PDF was not opened.',
    },
    extensions: [],
  },
  Instance: function () {
    let viewer, ui, active, closing = false;
    let advanceTimer;
    const cancelAdvance = () => { clearTimeout(advanceTimer); advanceTimer = undefined; };
    const apps = new Map();
    this.state = null;
    this.gui = { busy: false };
    this.error = null;
    this.init = async () => this.emit("init");
    this.ready = async () => this.emit("ready");
    this.emit = async type => {
      for (const extension of [].concat(this.extensions || []))
        if (extension) await extension({ app: this, type });
    };
    const node = (tag, className, text) => {
      const el = document.createElement(tag);
      if (className) el.className = className;
      if (text !== undefined) el.textContent = text;
      return el;
    };
    const controls = () => {
      if (!ui) return;
      const disabled = this.gui.busy || !this.state;
      ui.previous.disabled = disabled || this.state.index === 0;
      ui.next.disabled = disabled || this.state.index === this.state.slides.length - 1;
      ui.root.setAttribute("aria-busy", String(this.gui.busy));
    };
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
    const pause = () => {
      cancelAdvance();
      ui?.details.querySelectorAll("audio").forEach(audio => audio.pause());
    };
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
    const mediaURL = value => {
      if (typeof value !== "string" || !value.trim()) throw new TypeError("Empty media URL.");
      const url = new URL(value, document.baseURI);
      if (!["http:", "https:", "blob:"].includes(url.protocol)) throw new TypeError("Invalid media URL.");
      return url.href;
    };
    // A small HTML allowlist permits prose formatting without scripts, event handlers or active embeds.
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
    const show = async index => {
      const slide = this.state.slides[index];
      pause();
      // Restore the viewer's measurable layout before fitting a PDF page after an app/image.
      ui.pdf.hidden = slide.page === undefined;
      if (slide.page !== undefined) {
        await viewer.goToPage(slide.page);
        if (viewer.state.zoom === "page-width") await viewer.setZoom("page-width");
      }
      let app;
      if (slide.app) {
        app = apps.get(index);
        if (!app) {
          ui.embedded.hidden = false;
          const host = node("div");
          ui.embedded.replaceChildren(host);
          const [op, component, config = {}] = structuredClone(slide.app);
          app = await this.ccm.helper.solveDependency([op, component, config, host], this);
          apps.set(index, app);
        }
      }
      ui.image.hidden = !slide.image;
      if (slide.image) { ui.image.src = mediaURL(slide.image); ui.image.alt = slide.title || `${this.labels.slide} ${index + 1}`; }
      else ui.image.removeAttribute("src");
      ui.embedded.hidden = !app;
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
          onLink: async ({ page }) => {
            if (closing || this.gui.busy || !this.state) return;
            // Prefer the current occurrence, otherwise the first occurrence in the sequence.
            const index = this.state.slides[this.state.index].page === page ? this.state.index
              : this.state.slides.findIndex(slide => slide.page === page);
            if (index < 0) { ui.status.textContent = this.labels.missingLinkTarget; return; }
            await this.goTo(index);
            ui?.root.focus({ preventScroll: true });
          }, }, ui.pdf);
        await viewer.start();
        if (!viewer.state) { ui.status.textContent = this.labels.pdfNotOpened; return; }
      }
      const slides = input.length ? input : Array.from({ length: viewer.state.pages }, (_, i) => ({ page: i + 1 }));
      validate(slides);
      this.state = { pdf: this.pdf, index: 0, slides };
      await show(0);
      await this.emit("start");
    });
    /** Zero-based position in the mixed slide/app sequence. */
    this.goTo = index => run(async () => {
      if (!this.state) return;
      if (!Number.isInteger(index) || index < 0 || index >= this.state.slides.length) throw new RangeError("Invalid step.");
      if (index === this.state.index) return;
      const previous = this.state.index;
      try { await show(index); }
      catch (error) { await show(previous).catch(() => {}); throw error; }
      await this.emit("change");
    });
    /** Serializable snapshot; no DOM nodes or running component instances. */
    this.getValue = () => structuredClone(this.state);
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
  },
};
