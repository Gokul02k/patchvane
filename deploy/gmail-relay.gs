/* Patchvane's way of sending mail for nothing, forever.
 *
 * Every transactional mail provider's free tier is a trial wearing a
 * disguise: it expires, or it wants a domain you have to buy, or one day it
 * wants a card.  This is the alternative.  It is a Google Apps Script web
 * app, which is fifteen lines of Javascript in your own Drive behind an
 * HTTPS URL, and it sends through your own Gmail account.
 *
 * Two things follow from that, and the second is the real reason:
 *
 *   It is free.  A hundred recipients a day on an ordinary gmail.com
 *   account, 1500 on Workspace, and no plan to be moved off.
 *
 *   It arrives.  The mail is sent by Gmail, from your address, signed the
 *   way everything else you send is signed.  A gmail.com address pushed
 *   through a bulk sender is the exact shape a spam filter is built to
 *   catch, and a sign-up code in a spam folder is somebody who cannot sign
 *   up.
 *
 * It is also the only route here that never sees a password: it holds no
 * credential of yours at all, because it *is* you.
 *
 * ---------------------------------------------------------------- setting up
 *
 *  1. Make the secret the server and this script will share:
 *
 *         python3 -c "import secrets; print(secrets.token_urlsafe(32))"
 *
 *  2. script.google.com, New project, delete what is there, paste this in,
 *     and put that secret in SECRET below.  Name it something you will
 *     recognise in a year.
 *
 *  3. Deploy, New deployment, the gear, Web app.
 *         Execute as        Me
 *         Who has access    Anyone
 *     Both matter.  "Me" is what lets it send as you; "Anyone" is what lets
 *     the server reach it at all, and it is not as open as it sounds --
 *     without the secret this script does nothing but say no.
 *
 *  4. Authorise it.  It will warn that the app is unverified, because it is
 *     yours and you have not asked Google to review it: Advanced, then go
 *     ahead.  You are granting it to yourself.
 *
 *  5. Copy the deployment URL, the one ending in /exec, and set both of
 *     these where the server runs:
 *
 *         PATCHVANE_GAS_URL=https://script.google.com/macros/s/..../exec
 *         PATCHVANE_GAS_SECRET=the secret from step 1
 *
 * Changing this script later needs Deploy, Manage deployments, the pencil,
 * Version: New version.  A plain save does not change what the URL serves.
 */

var SECRET = "put-the-secret-here";

function doPost(e) {
  var msg;
  try {
    msg = JSON.parse(e.postData.contents);
  } catch (err) {
    return said("ERR that was not JSON");
  }

  /* The URL is the only thing stopping the internet at large from sending
     mail as you, and a URL is not a secret: it is in a log somewhere the
     moment it is used.  This is. */
  if (!SECRET || SECRET === "put-the-secret-here") {
    return said("ERR this relay has no secret set");
  }
  if (String(msg.secret || "") !== SECRET) {
    return said("ERR no");
  }
  if (!msg.to || !msg.subject) {
    return said("ERR nothing to send");
  }

  /* Refuse before Gmail does.  Running out mid-flight looks to whoever is
     signing up like their address was rejected, which is not what
     happened. */
  var left = MailApp.getRemainingDailyQuota();
  if (left < 1) {
    return said("ERR out of quota for today");
  }

  var out = {
    to: String(msg.to),
    subject: String(msg.subject),
    body: String(msg.text || ""),
    htmlBody: String(msg.html || ""),
    name: String(msg.from_name || "Patchvane"),
  };
  if (msg.reply_to) {
    out.replyTo = String(msg.reply_to);
  }

  try {
    MailApp.sendEmail(out);
  } catch (err) {
    return said("ERR " + err.message);
  }
  return said("OK " + (left - 1) + " left today");
}

/* A GET is somebody pasting the URL into a browser to see if it is alive.
   Tell them, and tell them nothing else. */
function doGet() {
  return said("OK patchvane mail relay, " +
              MailApp.getRemainingDailyQuota() + " left today");
}

function said(text) {
  return ContentService.createTextOutput(text)
                       .setMimeType(ContentService.MimeType.TEXT);
}
