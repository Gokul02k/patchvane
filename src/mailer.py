"""Outbound mail: codes, welcomes, and the notice that a password changed.

Everything else this server does over the network it does by reading.  This
is the one place it asks somebody else to deliver something, and it is worth
saying why it is built the way it is.

The obvious way to send mail from Python is smtplib, and on a machine you
own that is exactly what happens here.  It is not what happens on the
deployment: Render blocks outbound connections to ports 25, 465 and 587 on
free services, so an SMTP send from there does not fail, it hangs until it
times out.  Anywhere that is true -- and most free hosts have the same rule,
for the same anti-spam reason -- the way out is an email provider's ordinary
HTTPS API on port 443, which nobody blocks.

So there are several transports and one interface.  Which one is used is
decided by which credentials are in the environment, so a deployment that
moves hosts changes an environment variable and nothing else:

    PATCHVANE_GAS_URL           your own Gmail, through a Google Apps Script
                                relay, with _GAS_SECRET  (see below)
    PATCHVANE_BREVO_KEY         Brevo, https://api.brevo.com
    PATCHVANE_MAILJET_KEY       Mailjet, with _MAILJET_SECRET
    PATCHVANE_RESEND_KEY        Resend
    PATCHVANE_SENDGRID_KEY      SendGrid
    PATCHVANE_MAILGUN_KEY       Mailgun, with _MAILGUN_DOMAIN
    PATCHVANE_SMTP_HOST         plain SMTP, with _SMTP_USER and _SMTP_PASSWORD

    PATCHVANE_MAIL_FROM         the address people see it come from
    PATCHVANE_MAIL_TRANSPORT    pin one, instead of taking the first configured

The first one wants explaining, because it is the only one that costs
nothing and stays costing nothing.  Every provider in that list has a free
tier that is a trial in disguise: it expires, or it needs a domain you have
to buy, or one day it asks for a card.  A Google Apps Script web app does
not.  It is fifteen lines of Javascript sitting in your own Drive, deployed
at an HTTPS URL, which calls MailApp.sendEmail and so sends as you, from
your own Gmail address, signed by Google like any other mail you send.
That last part matters more than the price: an address at gmail.com sent
through a bulk provider is the exact shape spam filters are looking for,
and a sign-up code in a spam folder is a person who cannot sign up.  The
limit is a hundred recipients a day, which is a hundred new accounts a day.

deploy/gmail-relay.gs is the script, and docs/deploying.md walks through
deploying it.

With none of them set, and only outside cloud mode, the code is written to
the server log instead of sent.  That is how the sign-up flow is developed
and tested on a laptop without an account anywhere.
"""

import json
import os
import smtplib
import ssl
import urllib.error
import urllib.parse
import urllib.request
from email.message import EmailMessage
from email.utils import formataddr

TIMEOUT = 20


def env(name: str, default: str = "") -> str:
    val = os.environ.get(name)
    if val is None and name.startswith("PATCHVANE_"):
        val = os.environ.get("MAINLINE_" + name[len("PATCHVANE_"):])
    return (val if val is not None else default).strip()


GAS_URL = env("PATCHVANE_GAS_URL")
GAS_SECRET = env("PATCHVANE_GAS_SECRET")

BREVO = env("PATCHVANE_BREVO_KEY")
MAILJET = env("PATCHVANE_MAILJET_KEY")
MAILJET_SECRET = env("PATCHVANE_MAILJET_SECRET")
RESEND = env("PATCHVANE_RESEND_KEY")
SENDGRID = env("PATCHVANE_SENDGRID_KEY")
MAILGUN = env("PATCHVANE_MAILGUN_KEY")
MAILGUN_DOMAIN = env("PATCHVANE_MAILGUN_DOMAIN")
MAILGUN_BASE = env("PATCHVANE_MAILGUN_BASE", "https://api.mailgun.net")

SMTP_HOST = env("PATCHVANE_SMTP_HOST")
SMTP_PORT = int(env("PATCHVANE_SMTP_PORT", "587") or 587)
SMTP_USER = env("PATCHVANE_SMTP_USER")
SMTP_PASSWORD = env("PATCHVANE_SMTP_PASSWORD")

FROM = env("PATCHVANE_MAIL_FROM") or SMTP_USER
FROM_NAME = env("PATCHVANE_MAIL_FROM_NAME", "Patchvane")
REPLY_TO = env("PATCHVANE_MAIL_REPLY_TO")

# Where the sign-in link in a welcome mail points.  Render sets RENDER_EXTERNAL_URL
# for us; anywhere else it has to be said.
SITE = (env("PATCHVANE_URL") or env("RENDER_EXTERNAL_URL")).rstrip("/")


def transports() -> list:
    """Every way this process could send mail right now, best first."""
    out = []
    if GAS_URL and GAS_SECRET:
        out.append("gas")
    if BREVO:
        out.append("brevo")
    if MAILJET and MAILJET_SECRET:
        out.append("mailjet")
    if RESEND:
        out.append("resend")
    if SENDGRID:
        out.append("sendgrid")
    if MAILGUN and MAILGUN_DOMAIN:
        out.append("mailgun")
    if SMTP_HOST:
        out.append("smtp")
    return out


CLOUD = env("PATCHVANE_MODE", "local").lower() == "cloud"


def transport() -> str:
    """The one that will be used.  Empty means mail cannot be sent.

    "log" is the one that is not a provider: the message goes to the server's
    own log instead of into a mailbox.  That is how the sign-up flow gets
    developed on a laptop without an account anywhere, and it is only ever
    reached outside cloud mode, where the log is the operator's own terminal
    rather than a hosting dashboard."""
    pinned = env("PATCHVANE_MAIL_TRANSPORT").lower()
    ways = transports()
    if pinned:
        return pinned if pinned in ways or pinned == "log" else ""
    if ways:
        return ways[0]
    return "" if CLOUD else "log"


def ready() -> bool:
    way = transport()
    # The Apps Script relay sends as whoever deployed it, so it is the one
    # route that needs no address configured here.
    return bool(way) and (way in ("log", "gas") or bool(FROM))


def why_not() -> str:
    """What an operator has to do about it, in the words they would search for."""
    if not transports():
        return ("No way to send mail is configured, so no code can be sent. "
                "The free one is your own Gmail through an Apps Script relay: "
                "deploy deploy/gmail-relay.gs and set PATCHVANE_GAS_URL and "
                "PATCHVANE_GAS_SECRET. Otherwise one of PATCHVANE_MAILJET_KEY "
                "with _MAILJET_SECRET, PATCHVANE_BREVO_KEY, "
                "PATCHVANE_RESEND_KEY, PATCHVANE_SENDGRID_KEY, "
                "PATCHVANE_MAILGUN_KEY, PATCHVANE_SMTP_HOST.")
    if not FROM:
        return ("PATCHVANE_MAIL_FROM is not set, so there is no address to "
                "send from. It has to be one the provider has verified.")
    return ""


# ------------------------------------------------------------------ sending


def _post(url: str, data: bytes, headers: dict) -> tuple:
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return True, "%s %d" % (transport(), resp.status)
    except urllib.error.HTTPError as exc:
        # The provider's own words about what was wrong with the message are
        # the only useful thing in the failure, and are worth keeping.
        try:
            detail = exc.read().decode("utf-8", "replace")[:400]
        except Exception:
            detail = ""
        return False, "%d %s %s" % (exc.code, exc.reason, detail)
    except Exception as exc:
        return False, str(exc)


def _gas(to: str, name: str, subject: str, html: str, text: str) -> tuple:
    """Hand the message to a script of your own, which sends it as you.

    Apps Script answers the POST with a 302 to a one-time result URL and
    only serves the output from there.  urllib follows that redirect as a
    GET, which is exactly what Google expects and the reason a curl with
    -X POST gets a 405 from it.  The script has run by then; the redirect
    only carries what it returned."""
    body = {"secret": GAS_SECRET, "to": to, "name": name, "subject": subject,
            "html": html, "text": text, "from_name": FROM_NAME,
            "reply_to": REPLY_TO}
    req = urllib.request.Request(
        GAS_URL, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            said = resp.read().decode("utf-8", "replace").strip()
    except urllib.error.HTTPError as exc:
        return False, "%d %s" % (exc.code, exc.reason)
    except Exception as exc:
        return False, str(exc)
    if said.startswith("OK"):
        return True, said
    # A web app that is not deployed as "Anyone" answers an anonymous
    # request with a sign-in or "you need access" page rather than an
    # error, so name the setting instead of quoting the HTML back.
    if "<html" in said.lower() or "accounts.google.com" in said:
        return False, ("Google answered with a sign-in or \u201cyou need "
                       "access\u201d page instead of running the script: its "
                       "\u201cWho has access\u201d is not set to "
                       "\u201cAnyone\u201d")
    return False, said[:300] or "the script said nothing"


def _mailjet(to: str, name: str, subject: str, html: str, text: str) -> tuple:
    import base64
    body = {"Messages": [{
        "From": {"Email": FROM, "Name": FROM_NAME},
        "To": [{"Email": to, "Name": name} if name else {"Email": to}],
        "Subject": subject,
        "TextPart": text,
        "HTMLPart": html,
    }]}
    if REPLY_TO:
        body["Messages"][0]["ReplyTo"] = {"Email": REPLY_TO}
    auth = base64.b64encode(
        ("%s:%s" % (MAILJET, MAILJET_SECRET)).encode()).decode()
    return _post("https://api.mailjet.com/v3.1/send",
                 json.dumps(body).encode(),
                 {"Authorization": "Basic " + auth,
                  "Content-Type": "application/json"})


def _brevo(to: str, name: str, subject: str, html: str, text: str) -> tuple:
    body = {
        "sender": {"email": FROM, "name": FROM_NAME},
        "to": [{"email": to, "name": name} if name else {"email": to}],
        "subject": subject,
        "htmlContent": html,
        "textContent": text,
    }
    if REPLY_TO:
        body["replyTo"] = {"email": REPLY_TO}
    return _post("https://api.brevo.com/v3/smtp/email",
                 json.dumps(body).encode(),
                 {"api-key": BREVO, "Content-Type": "application/json",
                  "Accept": "application/json"})


def _resend(to: str, name: str, subject: str, html: str, text: str) -> tuple:
    body = {"from": formataddr((FROM_NAME, FROM)),
            "to": [formataddr((name, to)) if name else to],
            "subject": subject, "html": html, "text": text}
    if REPLY_TO:
        body["reply_to"] = REPLY_TO
    return _post("https://api.resend.com/emails", json.dumps(body).encode(),
                 {"Authorization": "Bearer " + RESEND,
                  "Content-Type": "application/json"})


def _sendgrid(to: str, name: str, subject: str, html: str, text: str) -> tuple:
    body = {
        "personalizations": [{"to": [{"email": to, "name": name} if name
                                     else {"email": to}]}],
        "from": {"email": FROM, "name": FROM_NAME},
        "subject": subject,
        "content": [{"type": "text/plain", "value": text},
                    {"type": "text/html", "value": html}],
    }
    if REPLY_TO:
        body["reply_to"] = {"email": REPLY_TO}
    return _post("https://api.sendgrid.com/v3/mail/send",
                 json.dumps(body).encode(),
                 {"Authorization": "Bearer " + SENDGRID,
                  "Content-Type": "application/json"})


def _mailgun(to: str, name: str, subject: str, html: str, text: str) -> tuple:
    import base64
    form = {"from": formataddr((FROM_NAME, FROM)),
            "to": formataddr((name, to)) if name else to,
            "subject": subject, "text": text, "html": html}
    if REPLY_TO:
        form["h:Reply-To"] = REPLY_TO
    auth = base64.b64encode(("api:" + MAILGUN).encode()).decode()
    return _post("%s/v3/%s/messages" % (MAILGUN_BASE, MAILGUN_DOMAIN),
                 urllib.parse.urlencode(form).encode(),
                 {"Authorization": "Basic " + auth,
                  "Content-Type": "application/x-www-form-urlencoded"})


def _smtp(to: str, name: str, subject: str, html: str, text: str) -> tuple:
    msg = EmailMessage()
    msg["From"] = formataddr((FROM_NAME, FROM))
    msg["To"] = formataddr((name, to)) if name else to
    msg["Subject"] = subject
    if REPLY_TO:
        msg["Reply-To"] = REPLY_TO
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")
    try:
        if SMTP_PORT == 465:
            server = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=TIMEOUT,
                                      context=ssl.create_default_context())
        else:
            server = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=TIMEOUT)
            server.starttls(context=ssl.create_default_context())
        with server:
            if SMTP_USER:
                server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(msg)
        return True, "smtp ok"
    except Exception as exc:
        return False, str(exc)


SENDERS = {"gas": _gas, "brevo": _brevo, "mailjet": _mailjet,
           "resend": _resend, "sendgrid": _sendgrid, "mailgun": _mailgun,
           "smtp": _smtp}


def send(to: str, subject: str, html: str, text: str, name: str = "",
         log=None) -> tuple:
    """Deliver one message.  Returns (sent, what happened).

    The detail is for the server log and never for the page: a provider's
    rejection names the account, the sending domain and sometimes the key,
    and none of that is the business of whoever is signing up."""
    way = transport()
    if way == "log":
        # Development without a provider.  The whole message goes to the log,
        # because a code nobody can read is a flow nobody can test.
        if log:
            log("mail written to the log, not sent (%s)\n"
                "--- to %s: %s ---\n%s" % (why_not(), to, subject, text))
        return True, "written to the log"
    if not ready():
        if log:
            log("mail could not be sent to %s: %s" % (mask(to), why_not()))
        return False, why_not()
    ok, detail = SENDERS[way](to, name, subject, html, text)
    if log:
        log("mail to %s via %s: %s" % (mask(to), way, "sent" if ok else detail))
    return ok, detail


def mask(addr: str) -> str:
    """An address in a log should not be readable as an address."""
    if "@" not in addr:
        return "***"
    user, _, host = addr.partition("@")
    return "%s***@%s" % (user[:1], host)


# ----------------------------------------------------------------- the look


# Mail clients are a decade behind browsers, so this is table markup with
# inline styles, which is the only thing that lands the same way in Gmail,
# Outlook and Apple Mail.
#
# The mark is drawn rather than linked.  Most clients refuse to load remote
# images until the reader clicks "show images", so a logo behind a URL is a
# broken picture on first read -- exactly the read where an unfamiliar sender
# most needs to look like itself.  Rounded corners and a solid fill are two
# things every client can do unaided.

BLUE = "#4c8dff"
INK = "#0b0f17"
BODY_BG = "#f4f6fb"
CARD = "#ffffff"
FAINT = "#6b7482"
LINE = "#e4e8f0"
FONT = ("-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,"
        "Arial,sans-serif")


def shell(title: str, inner: str, footer: str = "") -> str:
    """One message, in the frame every message shares."""
    return """\
<!doctype html>
<html><body style="margin:0;padding:0;background:%(bg)s;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">%(title)s</div>
<table role="presentation" width="100%%" cellpadding="0" cellspacing="0"
       style="background:%(bg)s;padding:28px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%%" cellpadding="0" cellspacing="0"
         style="max-width:520px;background:%(card)s;border:1px solid %(line)s;
                border-radius:14px;overflow:hidden;">

    <tr><td style="padding:22px 28px;border-bottom:1px solid %(line)s;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td width="36" height="36" align="center" valign="middle"
            style="background:%(blue)s;border-radius:10px;width:36px;height:36px;
                   color:#ffffff;font:700 18px/36px %(font)s;">P</td>
        <td style="padding-left:12px;font:600 16px/1.2 %(font)s;color:%(ink)s;">
          Patchvane<br>
          <span style="font:400 11px/1.5 %(font)s;color:%(faint)s;letter-spacing:.06em;
                       text-transform:uppercase;">upstream patch tracker</span>
        </td>
      </tr></table>
    </td></tr>

    <tr><td style="padding:28px;font:400 14px/1.65 %(font)s;color:%(ink)s;">
%(inner)s
    </td></tr>

    <tr><td style="padding:18px 28px;background:#fafbfe;border-top:1px solid %(line)s;
                   font:400 11.5px/1.6 %(font)s;color:%(faint)s;">
      %(footer)s
    </td></tr>
  </table>
  <div style="max-width:520px;padding:14px 8px;font:400 11px/1.6 %(font)s;
              color:%(faint)s;text-align:center;">
    Patchvane reads public kernel archives. It never posts anything anywhere.
  </div>
</td></tr></table>
</body></html>""" % dict(
        bg=BODY_BG, card=CARD, line=LINE, blue=BLUE, ink=INK, faint=FAINT,
        font=FONT, title=esc(title), inner=inner,
        footer=footer or "Patchvane will never ask you for your password by "
                         "email, and never sends it in one.")


def esc(s: str) -> str:
    return (str(s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def button(label: str, href: str) -> str:
    return ("""<table role="presentation" cellpadding="0" cellspacing="0"
       style="margin:22px 0 4px;"><tr><td align="center"
       style="background:%s;border-radius:9px;">
       <a href="%s" style="display:inline-block;padding:11px 22px;color:#ffffff;
          font:600 14px/1 %s;text-decoration:none;">%s</a>
    </td></tr></table>""" % (BLUE, esc(href), FONT, esc(label)))


def code_block(code: str) -> str:
    return ("""<div style="margin:22px 0;padding:16px;text-align:center;
       background:#f2f6ff;border:1px solid #d8e4ff;border-radius:11px;
       font:700 30px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
       color:%s;letter-spacing:.34em;text-indent:.34em;">%s</div>"""
            % (INK, esc(code)))


# ------------------------------------------------------------- the messages


def honorific(gender: str) -> str:
    """How to address somebody who told us, and nothing when they did not."""
    return {"male": "Mr", "female": "Ms"}.get((gender or "").lower(), "")


def greet(first: str, gender: str = "") -> str:
    title = honorific(gender)
    who = (first or "there").strip()
    return "Hi %s %s," % (title, who) if title and first else "Hi %s," % who


def send_code(to: str, code: str, first: str = "", gender: str = "",
              minutes: int = 10, new_account: bool = True, log=None) -> tuple:
    """The one-time code, for a sign-up or for a forgotten password."""
    what = ("finish setting up your Patchvane account"
            if new_account else "choose a new Patchvane password")
    inner = """
      <p style="margin:0 0 8px;">%(greet)s</p>
      <p style="margin:0;color:%(faint)s;">Use this code to %(what)s.</p>
      %(code)s
      <p style="margin:0;color:%(faint)s;">It works once, and expires in
      %(mins)d minutes. If you did not ask for it, nothing has happened to
      your account and you can ignore this message.</p>
    """ % dict(greet=esc(greet(first, gender)), what=esc(what),
               code=code_block(code), mins=minutes, faint=FAINT)
    text = ("%s\n\nUse this code to %s:\n\n    %s\n\n"
            "It works once and expires in %d minutes. If you did not ask for "
            "it, ignore this message.\n" % (greet(first, gender), what, code,
                                            minutes))
    subject = "%s is your Patchvane code" % code
    return send(to, subject, shell(subject, inner), text, name=first, log=log)


def send_welcome(to: str, username: str, first: str = "", last: str = "",
                 gender: str = "", log=None) -> tuple:
    """After the password is set.  It carries what the account is, and a way
    back in -- never the password itself.  A password in a mailbox is a
    password in every backup of that mailbox, forever."""
    link = SITE + "/login" if SITE else ""
    inner = """
      <p style="margin:0 0 8px;font:600 17px/1.35 %(font)s;">%(greet)s
      welcome to Patchvane.</p>
      <p style="margin:0 0 18px;color:%(faint)s;">Your account is ready. From
      here on it follows every patch you send to the Linux kernel: from the
      moment it appears on the list, through review, into a maintainer tree,
      into linux-next, and into mainline.</p>

      <table role="presentation" width="100%%" cellpadding="0" cellspacing="0"
             style="border:1px solid %(line)s;border-radius:11px;">
        <tr><td style="padding:14px 16px;border-bottom:1px solid %(line)s;">
          <div style="font:400 11px/1.4 %(font)s;color:%(faint)s;
                      text-transform:uppercase;letter-spacing:.06em;">Username</div>
          <div style="font:600 14px/1.5 %(font)s;">%(user)s</div>
        </td></tr>
        <tr><td style="padding:14px 16px;">
          <div style="font:400 11px/1.4 %(font)s;color:%(faint)s;
                      text-transform:uppercase;letter-spacing:.06em;">Email</div>
          <div style="font:600 14px/1.5 %(font)s;">%(mail)s</div>
        </td></tr>
      </table>
      <p style="margin:14px 0 0;color:%(faint)s;">Sign in with either of them
      and the password you just chose.</p>
      %(cta)s
      <p style="margin:22px 0 0;color:%(faint)s;">The first collection starts
      by itself and takes a few minutes; the dashboard will say how far it
      has got. It reads lore.kernel.org, patchwork.kernel.org and
      git.kernel.org, and nothing else.</p>
    """ % dict(greet=esc(greet(first, gender)), user=esc(username),
               mail=esc(to), font=FONT, faint=FAINT, line=LINE,
               cta=button("Open your dashboard", link) if link else "")
    text = ("%s welcome to Patchvane.\n\n"
            "Your account is ready.\n\n"
            "  Username  %s\n  Email     %s\n\n"
            "Sign in with either of them and the password you just chose.%s\n\n"
            "Patchvane follows every patch you send to the Linux kernel, from "
            "the list through review into mainline. The first collection "
            "starts by itself and takes a few minutes.\n\n"
            "We will never ask you for your password by email.\n"
            % (greet(first, gender), username, to,
               ("\n\n  " + link) if link else ""))
    subject = "Welcome to Patchvane, %s" % (first or username)
    return send(to, subject, shell(subject, inner), text, name=first, log=log)


def send_password_changed(to: str, username: str, first: str = "",
                          gender: str = "", log=None) -> tuple:
    """Somebody changed it.  If that somebody was not them, this is the only
    warning they will get."""
    link = SITE + "/login" if SITE else ""
    inner = """
      <p style="margin:0 0 8px;">%(greet)s</p>
      <p style="margin:0 0 6px;">The password for <b>%(user)s</b> was just
      changed.</p>
      <p style="margin:0;color:%(faint)s;">If that was you, there is nothing
      to do. If it was not, use "Forgot password" on the sign-in page now:
      resetting it again locks whoever did this out.</p>
      %(cta)s
    """ % dict(greet=esc(greet(first, gender)), user=esc(username),
               faint=FAINT, cta=button("Go to sign-in", link) if link else "")
    text = ("%s\n\nThe password for %s was just changed.\n\n"
            "If that was you, there is nothing to do. If it was not, use "
            "Forgot password on the sign-in page now.%s\n"
            % (greet(first, gender), username, ("\n\n  " + link) if link else ""))
    subject = "Your Patchvane password was changed"
    return send(to, subject, shell(subject, inner), text, name=first, log=log)
