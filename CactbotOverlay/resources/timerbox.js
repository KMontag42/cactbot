"use strict";

class TimerBox extends HTMLElement {
  static get observedAttributes() { return [ "duration", "threshold", "bg", "fg", "toward", "style", "hideafter", "roundupthreshold"]; }

  // The full duration of the current countdown. When this is changed,
  // the countdown restarts at the new value. If set to 0 then countdowns
  // are stopped.
  set duration(d) { this.setAttribute("duration", d); }
  get duration() { return this.getAttribute("duration"); }

  // Below this a large box is shown, above it a small box is shown.
  set threshold(t) { this.setAttribute("threshold", t); }
  get threshold() { return this.getAttribute("threshold"); }

  // All visual dimensions are scaled by this.
  set scale(s) { this.setAttribute("scale", s); }
  get scale() { return this.getAttribute("scale"); }

  // Background color.
  set bg(c) { this.setAttribute("bg", c); }
  get bg() { return this.getAttribute("bg"); }

  // Foreground color.
  set fg(c) { this.setAttribute("fg", c); }
  get fg() { return this.getAttribute("fg"); }

  // If "top" then animates bottom-to-top. If "bottom" then animates
  // top-to-bottom.
  set toward(t) { this.setAttribute("toward", t); }
  get toward() { return this.getAttribute("toward"); }

  // If "fill" then the animation goes empty-to-full, if "empty" then the
  // animation starts full and goes to empty.
  set style(s) { this.setAttribute("style", s); }
  get style() { return this.getAttribute("style"); }

  // When the timer reaches 0, it is hidden after this many seconds. If ""
  // then it is not hidden.
  set hideafter(h) { this.setAttribute("hideafter", h); }
  get hideafter() { return this.getAttribute("hideafter"); }

  // Current value.
  get value() { return this._value; }

  // Whether to round up the value to the nearest integer before thresholding.
  set roundupthreshold(r) { this.setAttribute("roundupthreshold", r); }
  get roundupthreshold() { return this.getAttribute("roundupthreshold"); }

  // This would be used with window.customElements.
  constructor() {
    super();
    var root = this.attachShadow({mode: 'open'});
    this.init(root);
  }
  
  // These would be used by document.registerElement, which is deprecated but
  // ACT uses an old CEF which has this instead of the newer APIs.
  createdCallback() {
    var root = this.createShadowRoot();
    this.init(root);
  }
  // Convert from the deprecated API names to the modern API names.
  attachedCallback() { this.connectedCallback(); }
  detachedCallback() { this.disconnectedCallback(); }

  init(root) {
    root.innerHTML = `
      <style>
        .bg {
          position: absolute;
        }
        .fg {
          position: absolute;
        }
        #timer {
          position: absolute;
          text-align: center;
          font-family: arial;
          font-weight: bold;
          color: white;
          text-shadow: -1px 0 3px black, 0 1px 3px black, 1px 0 3px black, 0 -1px 3px black;
        }
        #large, #small, #timer {
          display: none;
        }
        #large .fg {
          will-change: transform;
        }
        #timer {
          will-change: content;
        }
      </style>
      <div id="root" style="position: relative">
        <div id="large"><div class="bg"></div><div class="fg"></div></div>
        <div id="small"><div class="bg"></div><div class="fg"></div></div>
        <div id="timer"></div>
      </div>
    `
  }
  
  connectedCallback() {
    this.rootElement = this.shadowRoot.getElementById("root");
    this.largeBoxElement = this.shadowRoot.getElementById("large");
    this.largeBoxBackgroundElement = this.largeBoxElement.getElementsByClassName("bg")[0];
    this.largeBoxForegroundElement = this.largeBoxElement.getElementsByClassName("fg")[0];
    this.smallBoxElement = this.shadowRoot.getElementById("small");
    this.smallBoxBackgroundElement = this.smallBoxElement.getElementsByClassName("bg")[0];
    this.smallBoxForegroundElement = this.smallBoxElement.getElementsByClassName("fg")[0];
    this.timerElement = this.shadowRoot.getElementById("timer");

    // Constants.
    this.kLargeSize = 50;
    this.kSmallSize = 30;
    this.kBorderSize = 2;
    this.kFontSize = 16;
    this.kAnimateMS = 100;
    
    // Default values.
    this._value = 0;
    this._duration = 0;
    this._threshold = 7;
    this._bg = "rgba(0, 0, 0, 0.8)";
    this._fg = "red";
    this._scale = 1;
    this._toward_top = true;
    this._style_fill = true;
    this._hideafter = -1;
    this._round_up_threshold = true;

    if (this.duration != null) { this._duration = Math.max(parseFloat(this.duration), 0); }
    if (this.threshold != null) { this._threshold = Math.max(parseFloat(this.threshold), 0); }
    if (this.bg != null) { this._bg = this.bg; }
    if (this.fg != null) { this._fg = this.fg; }
    if (this.scale != null) { this._scale = Math.max(parseFloat(this.scale), 0.01); }
    if (this.toward != null) { this._toward_top = this.toward != "bottom"; }
    if (this.style != null) { this._style_fill = this.style != "empty"; }
    if (this.hideafter != null && this.hideafter != "") { this._hideafter = Math.max(parseFloat(this.hideafter), 0); }
    
    this._connected = true;
    this.layout();
    this.draw();
  }
  
  disconnectedCallback() {
    this.duration = 0;
    this._connected = false;
  }
  
  attributeChangedCallback(name, oldValue, newValue) {
    if (name == "duration") {
      this._duration = Math.max(parseFloat(newValue), 0);
      this.reset();
      return;
    }
    
    if (name == "threshold"){
      this._threshold = Math.max(parseFloat(newValue), 0);
    } else if (name == "toward") {
      this._toward_top = newValue != "bottom";
      this.layout();
    } else if (name == "style") {
      this._style_fill = newValue != "empty";
      this.layout();
    } else if (name == "bg") {
      this._bg = newValue;
      this.layout();
    } else if (name == "fg") {
      this._fg = newValue;
      this.layout();
    } else if (name == "hideafter") {
      this._hideafter = Math.max(parseFloat(this.hideafter), 0);
      if (this._value == 0 && this._hideafter >= 0)
        this.hide();
      else if (this._hideafter < 0)
        this.show();
    } else if (name == "roundupthreshold") {
      this._round_up_threshold = newValue;
    }

    this.draw();
  }
  
  layout() {
    // To start full and animate to empty, we animate backwards and flip
    // the direction.
    var toward_top = this._toward_top;
    if (this._style_fill)
      toward_top = !toward_top;
    
    var largeBackgroundStyle = this.largeBoxBackgroundElement.style;
    var smallBackgroundStyle = this.smallBoxBackgroundElement.style;
    var largeForegroundStyle = this.largeBoxForegroundElement.style;
    var smallForegroundStyle = this.smallBoxForegroundElement.style;

    smallBackgroundStyle.backgroundColor = this._bg;
    largeBackgroundStyle.backgroundColor = this._bg;
    smallForegroundStyle.backgroundColor = this._fg;
    largeForegroundStyle.backgroundColor = this._fg;

    largeBackgroundStyle.width = largeBackgroundStyle.height = this.kLargeSize * this._scale;
    smallBackgroundStyle.width = smallBackgroundStyle.height = this.kSmallSize * this._scale;
    largeForegroundStyle.width = largeForegroundStyle.height = (this.kLargeSize - this.kBorderSize * 2) * this._scale;
    smallForegroundStyle.width = smallForegroundStyle.height = (this.kSmallSize - this.kBorderSize * 2) * this._scale;

    smallBackgroundStyle.left = smallBackgroundStyle.top = (this.kLargeSize - this.kSmallSize) * this._scale / 2;
    smallForegroundStyle.left = smallForegroundStyle.top = (this.kLargeSize - this.kSmallSize) * this._scale / 2 + this.kBorderSize * this._scale;
    largeForegroundStyle.left = largeForegroundStyle.top = this.kBorderSize * this._scale;
    
    this.timerElement.style.width = this.kLargeSize * this._scale;
    this.timerElement.style.fontSize = '' + (this.kFontSize * this._scale) + "px";
    this.timerElement.style.top = (this.kLargeSize - this.kFontSize) * this._scale / 2;
    
    if (toward_top)
      largeForegroundStyle.transformOrigin = "0% 0%";
    else
      largeForegroundStyle.transformOrigin = "0% 100%";
  }

  draw() {
    if (!this._connected) return;

    var intvalue = parseInt(this._value + 0.99999999999);
    var rounded;
    if (this._round_up_threshold) {
      rounded = intvalue;
    } else {
      rounded = this._value;
    }

    if (rounded <= 0.000000001 || this._duration == 0) {
      this.largeBoxElement.style.display = "block";
      this.smallBoxElement.style.display = "none";
      this.timerElement.style.display = "none";
      this.largeBoxForegroundElement.style.transform = "";
    } else if (rounded > this._threshold) {
      this.largeBoxElement.style.display = "none";
      this.smallBoxElement.style.display = "block";
      this.timerElement.style.display = "block";
    } else {
      this.largeBoxElement.style.display = "block";
      this.smallBoxElement.style.display = "none";
      this.timerElement.style.display = "block";
      var animStartValue = this._duration > this._threshold ? this._threshold : this._duration;
      var animPercent = (animStartValue - this._value) / animStartValue;
      if (!this._style_fill)
        animPercent = 1.0 - animPercent;
      this.largeBoxForegroundElement.style.transform = "scale(1," + animPercent + ")";
    }

    // The default parseInt truncates but instead we should show
    // 1 for (0, 1], 2 for (1, 2], etc.
    this.timerElement.innerHTML = intvalue;
  }

  reset() {
    if (!this._connected) return;

    this.show();
    clearTimeout(this._hide_timer);
    this._hide_timer = null;
    clearTimeout(this._timer);
    this._timer = null;

    this._value = this._duration;
    this.advance();
  }
  
  advance() {
    if (this._value <= 0) {
      // Sets the attribute to 0 so users can see the counter is done, and
      // if they set the same duration again it will count.
      this.duration = 0;

      this._value = 0;
      if (this._hideafter >= 0) {
        this._hide_timer = setTimeout(this.hide(), this._hideafter);
      }
    } else {
      var that = this;
      this._timer = setTimeout(function() {
        that._value = that._value - (that.kAnimateMS / 1000);
        that.advance();
      }, this.kAnimateMS);
    }
    this.draw();
  }

  show() {
    this.rootElement.style.display = "block";
  }

  hide() {
    this.rootElement.style.display = "none";
  }
}

if (window.customElements) {
  // Preferred method but old CEF doesn't have this.
  window.customElements.define('timer-box', TimerBox);
} else {
  document.registerElement('timer-box', {
    prototype: Object.create(TimerBox.prototype)
  });
}