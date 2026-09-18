/* The way in: sign in, sign up, prove the address, choose a password.

   Kept out of the markup so the page needs no inline script, which is what
   lets the server send a Content-Security-Policy without 'unsafe-inline'.

   Every rule checked here is checked again on the server, and the server is
   the one that decides.  This copy exists so that a mistyped address is
   caught in the half second before somebody presses the button, rather than
   after a round trip -- it is a courtesy, never a gate. */

(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var on = function (el, ev, fn) { if (el) el.addEventListener(ev, fn); };

  var S = {
    step: "signin",
    token: "",            /* the flow the server is holding for us */
    kind: "signup",       /* or "reset": the same two screens, different words */
    busy: false,
    info: { signup: true, mail: true, code_minutes: 10, resend_seconds: 60 },
    tick: 0,              /* the resend countdown */
  };

  /* ------------------------------------------------------------ talking */

  function post(path, body) {
    return fetch("/api/auth/" + path, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        /* A cross-site form post cannot set this, which is what stops
           another page driving these endpoints. */
        "X-Requested-With": "patchvane",
      },
      body: JSON.stringify(body || {}),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (out) {
        if (!r.ok && !out.error) out.error = "Something went wrong. Try again.";
        return out;
      });
    }).catch(function () {
      return { error: "Could not reach the server. Check your connection." };
    });
  }

  /* --------------------------------------------------------- what shows */

  var STEPS = ["signin", "signup", "forgot", "code", "password", "extras"];

  function show(step, focus) {
    S.step = step;
    clearAll();
    STEPS.forEach(function (name) {
      var el = $("step-" + name);
      if (!el) return;
      var here = name === step;
      el.classList.toggle("hidden", !here);
      if (here) {
        /* Restart the entrance, so moving back and forth animates both
           ways rather than only the first time. */
        el.classList.remove("in");
        void el.offsetWidth;
        el.classList.add("in");
      }
    });
    var first = focus && $(focus);
    if (!first) {
      first = $("step-" + step).querySelector("input:not([type=hidden]), select");
    }
    if (first && !matchMedia("(max-width: 680px)").matches) first.focus();
  }

  function busy(btn, yes, label) {
    S.busy = yes;
    if (!btn) return;
    btn.disabled = yes;
    if (yes) {
      btn.dataset.said = btn.textContent;
      btn.textContent = label || "Just a moment\u2026";
    } else if (btn.dataset.said) {
      btn.textContent = btn.dataset.said;
    }
  }

  /* ------------------------------------------------------------- saying */

  function bad(field, why) {
    var slot = $("e-" + field);
    var box = $(field);
    if (slot) {
      slot.textContent = why || "";
      slot.classList.toggle("on", !!why);
    }
    if (box) {
      box.classList.toggle("bad", !!why);
      if (why) box.setAttribute("aria-invalid", "true");
      else box.removeAttribute("aria-invalid");
    }
    return !why;
  }

  function shout(why) {
    var box = $("err");
    box.textContent = why || "";
    box.classList.toggle("hidden", !why);
  }

  function clearAll() {
    shout("");
    ["who", "password", "first", "last", "username", "gender", "email",
     "fmail", "code", "pw1", "pw2", "pic", "aikey"]
      .forEach(function (f) { bad(f, ""); });
  }

  /* A complaint about a box goes away the moment they start putting it
     right, rather than sitting there red while they type the fix.  The
     three fields that say something of their own as you type -- the
     username and the two password boxes -- are left to do it themselves. */
  ["who", "password", "first", "last", "gender", "email", "fmail"]
    .forEach(function (f) {
      var box = $(f);
      if (!box) return;
      on(box, "input", function () { bad(f, ""); });
      on(box, "change", function () { bad(f, ""); });
    });

  /* Put a refusal from the server where it belongs: under its own box when
     it named one, at the top of the card when it did not.

     The box also has to be on the step being shown.  Every step is in the
     page at once and the hidden ones still have their slots, so a field name
     that belongs to another step would write the reason somewhere real and
     invisible -- and a button that has just been refused would look as
     though it had done nothing at all. */
  function landed(out) {
    var slot = out.field ? $("e-" + out.field) : null;
    if (!out.error) return true;
    if (slot && slot.closest(".step") === $("step-" + S.step)) {
      bad(out.field, out.error);
      var box = $(out.field);
      if (box) box.focus();
    } else {
      shout(out.error);
    }
    return false;
  }

  /* --------------------------------------------------------- the checks */

  /* Letters, because the people who send kernel patches are called
     Kleine-König and Łukasz, and a form that cannot spell somebody's name
     is a form telling them they do not belong here.

     Built from a string rather than written as a literal so that a browser
     without Unicode property escapes fails here, where it can fall back,
     instead of failing to parse the file at all. */
  var NAME;
  try {
    NAME = new RegExp("^\\p{L}[\\p{L}\\p{M} '\u2019.-]*$", "u");
  } catch (e) {
    NAME = /^[^\d!-\/:-@\[-`{-~]+$/;
  }
  var USER = /^[a-z][a-z0-9_]*$/;

  function nameProblem(v, which) {
    var name = (v || "").trim().replace(/\s+/g, " ");
    if (!name) return which + " is required.";
    if (name.length > 40) return which + " is longer than 40 characters.";
    if (!NAME.test(name)) {
      return which + " can have letters, spaces, hyphens and apostrophes.";
    }
    return "";
  }

  function userProblem(v) {
    var u = (v || "").trim().toLowerCase();
    if (!u) return "Username is required.";
    if (u.length < 3) return "Usernames are at least 3 characters.";
    if (u.length > 20) return "Usernames are at most 20 characters.";
    if (!USER.test(u)) {
      return "Letters, numbers and underscores, starting with a letter.";
    }
    return "";
  }

  function mailProblem(v) {
    var a = (v || "").trim().toLowerCase();
    if (!a) return "Email address is required.";
    if (a.length > 254) return "That address is too long.";
    if ((a.match(/@/g) || []).length !== 1) return "An address has exactly one @ in it.";
    var half = a.split("@");
    if (!half[0] || !half[1]) return "That does not look like a complete address.";
    if (/^\.|\.$|\.\./.test(half[0])) {
      return "An address cannot start, end, or run two dots together.";
    }
    if (half[1].indexOf(".") < 0) return "The part after the @ needs a domain, like example.com.";
    if (!/^[a-z0-9.-]+$/.test(half[1]) || !/\.[a-z]{2,}$/.test(half[1])) {
      return "That domain does not look right.";
    }
    return "";
  }

  var RULES = {
    len: function (p) { return p.length >= 8; },
    upper: function (p) { return /[A-Z]/.test(p); },
    lower: function (p) { return /[a-z]/.test(p); },
    digit: function (p) { return /[0-9]/.test(p); },
    symbol: function (p) { return /[^A-Za-z0-9\s]/.test(p); },
  };

  var SAYS = {
    len: "At least 8 characters.",
    upper: "Add a capital letter.",
    lower: "Add a lowercase letter.",
    digit: "Add a number.",
    symbol: "Add a symbol, like ! ? @ # or -.",
  };

  /* The server refuses two more things than the list on screen describes: a
     password holding the username, and one holding the address.  Neither can
     be a tick in that list, because both are about something typed on an
     earlier step rather than about the password on its own -- so they are
     checked here, at the moment the button is pressed, and said in the same
     words the server would use.

     The list of passwords everybody guesses stays on the server.  Mirroring
     it here would mean shipping it to every visitor and keeping two copies
     in step, and a refusal from it now shows up properly anyway. */
  function pwProblem(p, who) {
    if (p !== p.trim()) return "It cannot start or end with a space.";
    var names = Object.keys(RULES);
    for (var i = 0; i < names.length; i++) {
      if (!RULES[names[i]](p)) return SAYS[names[i]];
    }
    if (p.length > 128) return "That is longer than 128 characters.";
    var low = p.toLowerCase();
    var user = ((who || {}).username || "").toLowerCase();
    var local = ((who || {}).email || "").split("@")[0].toLowerCase();
    if (user.length > 2 && low.indexOf(user) >= 0) {
      return "It should not contain your username.";
    }
    if (local.length > 2 && low.indexOf(local) >= 0) {
      return "It should not contain your email address.";
    }
    return "";
  }

  /* What they typed on the way to this step, for the two checks above.
     Resetting a password never asked for a username, so that one is left
     empty and the server remains the one that knows. */
  function pwContext() {
    var making = S.kind === "signup";
    return {
      username: making ? $("username").value.trim() : "",
      email: (making ? $("email").value : $("fmail").value).trim(),
    };
  }

  function strength(p) {
    var kinds = ["upper", "lower", "digit", "symbol"].filter(function (k) {
      return RULES[k](p);
    }).length;
    var n = 0;
    if (p.length >= 8) n++;
    if (p.length >= 12) n++;
    if (p.length >= 16) n++;
    if (kinds >= 3) n++;
    if (kinds === 4 && p.length >= 10) n++;
    return Math.max(0, Math.min(4, n));
  }

  /* ---------------------------------------------------------- sign in */

  on($("go-signin"), "click", function () {
    if (S.busy) return;
    clearAll();
    var who = $("who").value.trim();
    var pw = $("password").value;
    if (!who) return bad("who", "Enter your username or email address.");
    if (!pw) return bad("password", "Enter your password.");

    busy($("go-signin"), true, "Signing in\u2026");
    post("login", { who: who, password: pw }).then(function (out) {
      busy($("go-signin"), false);
      if (!landed(out)) {
        $("password").value = "";
        return;
      }
      location.href = out.to || "/";
    });
  });

  /* ---------------------------------------------------------- sign up */

  function signupFields() {
    return {
      first: $("first").value.trim().replace(/\s+/g, " "),
      last: $("last").value.trim().replace(/\s+/g, " "),
      username: $("username").value.trim().toLowerCase(),
      gender: $("gender").value,
      email: $("email").value.trim().toLowerCase(),
    };
  }

  on($("go-signup"), "click", function () {
    if (S.busy) return;
    clearAll();
    var f = signupFields();
    var wrong = [
      ["first", nameProblem(f.first, "First name")],
      ["last", nameProblem(f.last, "Last name")],
      ["username", userProblem(f.username)],
      ["gender", f.gender ? "" : "Please pick one, or choose not to say."],
      ["email", mailProblem(f.email)],
    ].filter(function (pair) { return pair[1]; });

    if (wrong.length) {
      /* All of them at once, so the form is fixed in one pass rather than
         one message at a time. */
      wrong.forEach(function (pair) { bad(pair[0], pair[1]); });
      var box = $(wrong[0][0]);
      if (box) box.focus();
      return;
    }

    busy($("go-signup"), true, "Sending the code\u2026");
    post("start", f).then(function (out) {
      busy($("go-signup"), false);
      if (!landed(out)) return;
      S.token = out.token;
      S.kind = "signup";
      toCode(out.sent_to);
    });
  });

  /* Usernames are checked as they are typed, because finding out the name
     is taken after filling in the rest of the form is the worst moment to
     find out. */
  var asking = 0;
  on($("username"), "input", function () {
    var user = $("username").value.trim().toLowerCase();
    var why = userProblem(user);
    if (why || !user) {
      bad("username", user ? why : "");
      return;
    }
    bad("username", "");
    var mine = ++asking;
    post("username", { username: user }).then(function (out) {
      if (mine !== asking || S.step !== "signup") return;
      if (out.error) return bad("username", out.error);
      var slot = $("e-username");
      slot.textContent = out.free ? "\u2713 " + user + " is free"
                                  : "That username is taken. Try another.";
      slot.classList.add("on");
      slot.classList.toggle("good", !!out.free);
    });
  });

  /* ----------------------------------------------------------- forgot */

  on($("go-forgot"), "click", function () {
    if (S.busy) return;
    clearAll();
    var mail = $("fmail").value.trim().toLowerCase();
    var why = mailProblem(mail);
    if (why) return bad("fmail", why);

    busy($("go-forgot"), true, "Sending the code\u2026");
    post("forgot", { email: mail }).then(function (out) {
      busy($("go-forgot"), false);
      if (out.field === "email") out.field = "fmail";
      if (!landed(out)) return;
      S.token = out.token;
      S.kind = "reset";
      toCode(out.sent_to);
    });
  });

  /* ------------------------------------------------------------- code */

  var boxes = Array.prototype.slice.call($("otp").querySelectorAll("input"));

  function typed() {
    return boxes.map(function (b) { return b.value; }).join("");
  }

  function fill(text) {
    var digits = (text || "").replace(/\D/g, "").slice(0, 6).split("");
    boxes.forEach(function (b, i) { b.value = digits[i] || ""; });
    var next = Math.min(digits.length, 5);
    boxes[next].focus();
    if (digits.length === 6) $("go-code").click();
  }

  boxes.forEach(function (box, i) {
    on(box, "input", function () {
      box.value = box.value.replace(/\D/g, "").slice(-1);
      bad("code", "");
      if (box.value && i < 5) boxes[i + 1].focus();
      if (typed().length === 6) $("go-code").click();
    });
    on(box, "keydown", function (e) {
      if (e.key === "Backspace" && !box.value && i > 0) {
        boxes[i - 1].focus();
        boxes[i - 1].value = "";
        e.preventDefault();
      }
      if (e.key === "ArrowLeft" && i > 0) boxes[i - 1].focus();
      if (e.key === "ArrowRight" && i < 5) boxes[i + 1].focus();
    });
    /* One paste of all six digits is how most people move a code across
       from their mail client. */
    on(box, "paste", function (e) {
      e.preventDefault();
      fill((e.clipboardData || window.clipboardData).getData("text"));
    });
  });

  function toCode(where) {
    $("sentto").textContent = where || "your address";
    $("mins").textContent = S.info.code_minutes || 10;
    boxes.forEach(function (b) { b.value = ""; });
    show("code");
    boxes[0].focus();
    countdown(S.info.resend_seconds || 60);
  }

  function countdown(seconds) {
    clearInterval(S.tick);
    var left = seconds;
    var btn = $("resend");
    var paint = function () {
      if (left <= 0) {
        clearInterval(S.tick);
        btn.disabled = false;
        btn.textContent = "Send another code";
        return;
      }
      btn.disabled = true;
      btn.textContent = "Send another code in " + left + "s";
      left--;
    };
    paint();
    S.tick = setInterval(paint, 1000);
  }

  on($("go-code"), "click", function () {
    if (S.busy) return;
    var code = typed();
    if (code.length !== 6) return bad("code", "All six digits, please.");

    busy($("go-code"), true, "Checking\u2026");
    post("code", { token: S.token, code: code }).then(function (out) {
      busy($("go-code"), false);
      if (out.error) {
        bad("code", out.error);
        boxes.forEach(function (b) { b.value = ""; });
        boxes[0].focus();
        if (/start again/i.test(out.error)) {
          clearInterval(S.tick);
          setTimeout(function () {
            show(S.kind === "reset" ? "forgot" : "signup");
          }, 1400);
        }
        return;
      }
      clearInterval(S.tick);
      toPassword();
    });
  });

  on($("resend"), "click", function () {
    if (S.busy) return;
    bad("code", "");
    busy($("resend"), true, "Sending\u2026");
    post("resend", { token: S.token }).then(function (out) {
      busy($("resend"), false);
      if (out.error) {
        bad("code", out.error);
        countdown(15);
        return;
      }
      bad("code", "");
      var slot = $("e-code");
      slot.textContent = "A new code is on its way.";
      slot.classList.add("on", "good");
      countdown(S.info.resend_seconds || 60);
    });
  });

  on($("startover"), "click", function () {
    clearInterval(S.tick);
    S.token = "";
    show(S.kind === "reset" ? "forgot" : "signup");
  });

  /* --------------------------------------------------------- password */

  function toPassword() {
    var making = S.kind === "signup";
    $("pwtitle").textContent = making ? "Choose a password"
                                      : "Set a new password";
    $("pwlead").textContent = making
      ? "Last step. Make it one you do not use anywhere else."
      : "Choose a new one. You will be signed in straight after.";
    $("go-password").textContent = making ? "Create account" : "Save and sign in";
    $("pw1").value = "";
    $("pw2").value = "";
    paintRules("");
    show("password", "pw1");
  }

  function paintRules(pw) {
    Object.keys(RULES).forEach(function (name) {
      var li = $("rules").querySelector('[data-rule="' + name + '"]');
      if (li) li.classList.toggle("met", !!pw && RULES[name](pw));
    });
    $("meter").dataset.at = pw ? strength(pw) : 0;
  }

  on($("pw1"), "input", function () {
    paintRules($("pw1").value);
    bad("pw1", "");
    if ($("pw2").value) {
      bad("pw2", $("pw2").value === $("pw1").value ? "" : "Those two do not match.");
    }
  });

  on($("pw2"), "input", function () {
    var same = $("pw2").value === $("pw1").value;
    bad("pw2", !$("pw2").value || same ? "" : "Those two do not match.");
  });

  on($("go-password"), "click", function () {
    if (S.busy) return;
    clearAll();
    var pw = $("pw1").value;
    var again = $("pw2").value;
    var why = pwProblem(pw, pwContext());
    if (why) return bad("pw1", why);
    if (pw !== again) return bad("pw2", "Those two do not match.");

    busy($("go-password"), true,
         S.kind === "signup" ? "Creating your account\u2026" : "Saving\u2026");
    post("finish", { token: S.token, password: pw, confirm: again })
      .then(function (out) {
        busy($("go-password"), false);
        if (out.error) {
          /* The server names the keys it was sent; this step calls the same
             two boxes pw1 and pw2. */
          if (out.field === "password") out.field = "pw1";
          if (out.field === "confirm") out.field = "pw2";
          if (out.field === "username") {
            /* Somebody else finished with that name while this one was
               reading their inbox.  Back to the form, with it said. */
            show("signup", "username");
            bad("username", out.error);
            return;
          }
          if (out.field === "code") {
            show("code");
            bad("code", out.error);
            return;
          }
          landed(out);
          return;
        }
        /* Signed in from here on, which is what lets the optional step
           afterwards use the ordinary endpoints. Resetting a password has
           nothing optional to offer, so it goes straight through. */
        if (S.kind === "signup") openExtras(out);
        else location.href = out.to || "/";
      });
  });

  /* ----------------------------------------------- the optional last step */

  /* The account exists by now.  Nothing on this screen is required, nothing
     on it can fail in a way that costs them the account, and "Skip for now"
     is as complete an answer as filling it in. */

  var PIC = "";               /* the shrunk data URL, until it is sent */
  var INITIAL = "?";          /* what the circle shows with no picture in it */

  function openExtras(out) {
    var called = (out.first || "").trim();
    INITIAL = (called.charAt(0) || "?").toUpperCase();
    $("extitle").textContent = called ? "You are in, " + called : "You are in";
    $("picprev").textContent = INITIAL;
    show("extras");
    loadProviders();
  }

  function leave() { location.href = "/"; }

  /* The dashboard's list of models, which is readable now there is a
     session.  If it cannot be reached the whole row goes away rather than
     offering an empty menu. */
  function loadProviders() {
    fetch("/api/ai/providers", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (out) {
        var list = (out.providers || []).filter(function (p) {
          return p.where && !/YOUR-|example\.com/.test(p.endpoint || "");
        });
        if (!list.length) throw new Error("none");
        var sel = $("aiprov");
        sel.innerHTML = "";
        list.forEach(function (p) {
          var opt = document.createElement("option");
          opt.value = p.id;
          opt.textContent = p.label;
          opt.dataset.where = p.where || "";
          sel.appendChild(opt);
        });
        sayWhere();
      })
      .catch(function () {
        $("aiprov").closest(".field").hidden = true;
        $("aikey").closest(".field").hidden = true;
      });
  }

  function sayWhere() {
    var sel = $("aiprov");
    var where = (sel.options[sel.selectedIndex] || {}).dataset;
    $("aiwhere").textContent = where && where.where
      ? "Keys come from " + where.where + ". The assistant answers questions "
        + "about your own patches."
      : "";
  }

  on($("aiprov"), "change", sayWhere);

  /* The picture is shrunk here rather than sent whole: a phone camera gives
     four megabytes and a 26 pixel circle needs none of it.  Read as a data
     URL because this page's content policy allows data: images and not
     blob:. */
  function shrink(file, then, fail) {
    var fr = new FileReader();
    fr.onerror = function () { fail("That file could not be read."); };
    fr.onload = function () {
      var img = new Image();
      img.onerror = function () { fail("That is not a picture we can read."); };
      img.onload = function () {
        var side = Math.min(img.width, img.height);
        if (!side) return fail("That picture is empty.");
        var c = document.createElement("canvas");
        c.width = c.height = 256;
        var g = c.getContext("2d");
        g.imageSmoothingQuality = "high";
        g.drawImage(img, (img.width - side) / 2, (img.height - side) / 2,
                    side, side, 0, 0, 256, 256);
        then(c.toDataURL("image/jpeg", 0.85));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }

  on($("picpick"), "click", function () {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    on(input, "change", function () {
      var file = (input.files || [])[0];
      if (!file) return;
      bad("pic", "");
      shrink(file, function (url) {
        PIC = url;
        var prev = $("picprev");
        prev.innerHTML = "";
        var img = new Image();
        img.src = url;
        img.alt = "";
        prev.appendChild(img);
        $("picdrop").hidden = false;
      }, function (why) { bad("pic", why); });
    });
    input.click();
  });

  on($("picdrop"), "click", function () {
    PIC = "";
    $("picprev").textContent = INITIAL;
    $("picdrop").hidden = true;
    bad("pic", "");
  });

  on($("skipextras"), "click", leave);

  on($("go-extras"), "click", function () {
    if (S.busy) return;
    clearAll();
    var key = ($("aikey").value || "").trim();
    var provider = ($("aiprov").value || "");
    if (!PIC && !key) return leave();
    busy($("go-extras"), true, "Saving\u2026");

    /* Each is sent on its own and each reports against its own field: a key
       the model rejects should not cost them the picture, and either can be
       put right in Settings afterwards. */
    var jobs = [
      PIC ? toApp("/api/avatar", { image: PIC }) : null,
      key && provider
        ? toApp("/api/ai/key",
                { provider: provider, key: key, remember: true })
        : null,
    ];
    Promise.all(jobs.map(function (j) { return j || { ok: true }; }))
      .then(function (answers) {
        busy($("go-extras"), false);
        var trouble = false;
        [["pic", answers[0]], ["aikey", answers[1]]].forEach(function (pair) {
          if (pair[1] && pair[1].error) {
            bad(pair[0], pair[1].error);
            trouble = true;
          }
        });
        if (!trouble) leave();
      });
  });

  /* The dashboard's own endpoints rather than the sign-up ones, which is
     what the session we now hold is for. */
  function toApp(path, body) {
    return fetch(path, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "patchvane",
      },
      body: JSON.stringify(body || {}),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (out) {
        if (!r.ok && !out.error) out.error = "That could not be saved.";
        return out;
      });
    }).catch(function () {
      return { error: "Could not reach the server." };
    });
  }

  /* ------------------------------------------------------- odds and ends */

  /* Show and hide, because a password typed blind into a page you have not
     used before is a password typed wrong. */
  Array.prototype.forEach.call(document.querySelectorAll("[data-peek]"),
    function (btn) {
      on(btn, "click", function () {
        var box = $(btn.dataset.peek);
        var open = box.type === "password";
        box.type = open ? "text" : "password";
        btn.textContent = open ? "hide" : "show";
        btn.setAttribute("aria-label",
                         open ? "Hide password" : "Show password");
        box.focus();
      });
    });

  Array.prototype.forEach.call(document.querySelectorAll("[data-go]"),
    function (btn) {
      on(btn, "click", function () { show(btn.dataset.go); });
    });

  /* Enter submits whichever step is showing. */
  on(document, "keydown", function (e) {
    if (e.key !== "Enter" || S.busy) return;
    var go = $("go-" + S.step);
    if (go && !go.disabled) {
      e.preventDefault();
      go.click();
    }
  });

  /* Tidy up a name as soon as the field is left, so what is shown is what
     will be stored. */
  ["first", "last"].forEach(function (f) {
    on($(f), "blur", function () {
      $(f).value = $(f).value.trim().replace(/\s+/g, " ");
      if ($(f).value) bad(f, nameProblem($(f).value, f === "first"
                                         ? "First name" : "Last name"));
    });
  });
  on($("email"), "blur", function () {
    if ($("email").value) bad("email", mailProblem($("email").value));
  });

  /* An error the server put in the URL, from a redirect rather than a
     fetch. */
  var params = new URLSearchParams(location.search);
  if (params.get("error")) shout(params.get("error"));

  /* What this deployment can offer.  Asked rather than assumed, so a server
     that cannot send mail does not show a sign-up form that cannot work. */
  fetch("/api/signin", { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (info) {
      S.info = Object.assign(S.info, info || {});
      if (!S.info.signup) {
        $("to-signup").classList.add("hidden");
      }
      if (S.info.signup && !S.info.mail) {
        $("to-signup").classList.add("hidden");
        shout("This server cannot send email yet, so it is not taking new "
              + "accounts. Existing ones still sign in.");
      }
    })
    .catch(function () { /* the form works without it */ });

  show("signin");
}());
