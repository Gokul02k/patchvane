/* The moving background behind the way in.

   This is decoration and nothing else, which is why it is a file of its own
   and why the page never asks whether it worked.  If the script does not
   load, or the browser will not give us a canvas, what is left is the slow
   colour the stylesheet is already drifting about and nobody can tell that
   anything is missing.

   What it draws is the thing this site is for.  Patches rise; the line
   across the top is mainline; one that reaches it flares and is gone.  None
   of it is anybody's real data -- there is none to have before they have
   even signed in -- and it is abstract enough never to be mistaken for
   some.  It is a picture of the idea, not a chart.

   The budget is the point.  This runs behind a form somebody wants to
   finish, possibly on a laptop on battery, so it stops dead when the tab is
   hidden, it draws nothing at all when the machine has asked for stillness,
   and the count of moving things is worked out from the size of the window
   rather than fixed at a number that suits one screen. */
(function () {
  "use strict";

  var canvas = document.getElementById("rise");
  if (!canvas || !canvas.getContext) return;
  var g = canvas.getContext("2d");
  if (!g) return;

  /* The blue and cyan of the mark, and the green this interface uses
     everywhere else for something that landed.  Written out as numbers
     rather than read from the stylesheet because a custom property means
     nothing inside a canvas, and the alternative -- reading them back out of
     the computed style on every frame -- costs more than it saves. */
  var RISING = ["76,141,255", "45,212,191"];
  var LANDED = "63,185,80";

  var still = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

  var W = 0, H = 0, line = 0, dots = [], going = 0, last = 0;

  function quiet() { return !!(still && still.matches); }

  function sizeUp() {
    /* Two device pixels to the CSS pixel is as much as a handful of soft
       dots is worth.  A phone claiming three would have us filling nine
       times the area of a plain screen for a blur nobody can resolve. */
    var ratio = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    if (!W || !H) return false;
    canvas.width = Math.round(W * ratio);
    canvas.height = Math.round(H * ratio);
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    line = Math.round(H * 0.23);
    return true;
  }

  /* Enough to read as movement, never enough to read as weather.  A phone
     gets a dozen, a wide desktop something over forty. */
  function stock() {
    var want = Math.max(10, Math.min(44, Math.round(W * H / 34000)));
    dots = [];
    for (var i = 0; i < want; i++) {
      /* Scattered up the whole height to start with, so the first frame is
         already a going concern rather than a queue forming at the bottom. */
      dots.push(born(Math.random() * H));
    }
  }

  function born(at) {
    return {
      x: Math.random() * W,
      y: at,
      r: 1 + Math.random() * 1.6,
      /* In CSS pixels per sixtieth of a second; the frame loop scales it by
         however long the frame actually took. */
      up: 0.1 + Math.random() * 0.3,
      sway: 6 + Math.random() * 16,
      turn: 0.004 + Math.random() * 0.01,
      phase: Math.random() * Math.PI * 2,
      tint: RISING[(Math.random() * RISING.length) | 0],
      flare: 0,
      done: false,
    };
  }

  function move(d, dt) {
    d.y -= d.up * dt;
    d.phase += d.turn * dt;
    if (d.flare > 0) d.flare = Math.max(0, d.flare - 0.016 * dt);
    /* Crossing the line is the only event in the whole picture, so it is
       worth the one comparison a frame it costs. */
    if (!d.done && d.y <= line) {
      d.done = true;
      d.flare = 1;
    }
    if (d.y < -20) {
      var fresh = born(H + 20);
      fresh.x = Math.random() * W;
      dots[dots.indexOf(d)] = fresh;
    }
  }

  /* A soft dot without shadowBlur, which is the expensive way to do this:
     a wide faint disc with a small bright one inside it reads as a glow and
     costs two fills. */
  function spot(x, y, r, tint, alpha) {
    g.fillStyle = "rgba(" + tint + "," + (alpha * 0.16).toFixed(3) + ")";
    g.beginPath();
    g.arc(x, y, r * 4.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(" + tint + "," + alpha.toFixed(3) + ")";
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  function paint() {
    g.clearRect(0, 0, W, H);

    /* Mainline.  Faded out at both ends so it reads as something far away
       rather than as a rule drawn across the page. */
    var rule = g.createLinearGradient(0, 0, W, 0);
    rule.addColorStop(0, "rgba(76,141,255,0)");
    rule.addColorStop(0.5, "rgba(76,141,255,.16)");
    rule.addColorStop(1, "rgba(76,141,255,0)");
    g.fillStyle = rule;
    g.fillRect(0, line, W, 1);

    for (var i = 0; i < dots.length; i++) {
      var d = dots[i];
      var up = (H - d.y) / H;          /* 0 at the bottom, 1 at the top */
      /* In as it sets off and out as it leaves, so nothing is ever seen to
         appear from nowhere or to stop dead. */
      var alpha = Math.max(0, Math.min(1, up / 0.14, (1 - up) / 0.16));
      if (alpha <= 0) continue;
      var x = d.x + Math.sin(d.phase) * d.sway;
      var tint = d.flare > 0 ? LANDED : d.tint;

      spot(x, d.y, d.r, tint, alpha * 0.55);

      /* The flare: a ring opening outwards as it fades, which is the one
         moment in this that is meant to catch the eye at all. */
      if (d.flare > 0) {
        g.strokeStyle = "rgba(" + LANDED + "," +
                        (d.flare * alpha * 0.5).toFixed(3) + ")";
        g.lineWidth = 1;
        g.beginPath();
        g.arc(x, d.y, d.r + (1 - d.flare) * 22, 0, Math.PI * 2);
        g.stroke();
      }
    }
  }

  function frame(now) {
    going = 0;
    /* Scaled to a sixtieth of a second, and capped: coming back to a tab
       that has been in the background for a minute should carry on, not
       teleport everything off the top of the screen. */
    var dt = Math.min((now - last) / 16.667, 3);
    last = now;
    for (var i = 0; i < dots.length; i++) move(dots[i], dt);
    paint();
    run();
  }

  function run() {
    if (going || quiet() || document.hidden) return;
    going = requestAnimationFrame(frame);
  }

  function halt() {
    if (going) cancelAnimationFrame(going);
    going = 0;
  }

  function start() {
    if (!sizeUp()) return;
    stock();
    last = performance.now();
    /* Asked for stillness: one frame, so the page is not a blank rectangle
       where everybody else has a picture, and then nothing moves again. */
    if (quiet()) {
      halt();
      paint();
      return;
    }
    run();
  }

  /* A window being dragged to a new size fires this continuously, and
     rebuilding the whole field each time would be the one thing here that
     ever showed up in a profile. */
  var settling = 0;
  window.addEventListener("resize", function () {
    clearTimeout(settling);
    settling = setTimeout(start, 180);
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      halt();
    } else {
      last = performance.now();
      run();
    }
  });

  /* Turning stillness on in the system settings should stop this where it
     stands, without reloading the page to find out. */
  if (still) {
    var listen = still.addEventListener
      ? still.addEventListener.bind(still, "change")
      : still.addListener && still.addListener.bind(still);
    if (listen) listen(function () { halt(); start(); });
  }

  start();
}());
