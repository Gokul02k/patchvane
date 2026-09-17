"""Accounts: who somebody is, and how they proved the address is theirs.

Signing in used to mean logging into your own mailbox: you handed over a
Gmail app password, it was checked against Gmail over IMAP and thrown away.
That proved the address was yours, which is the only thing sign-in here has
ever needed to establish -- everything on the dashboard is collected from
public archives and the password could not read any of it.  But it asked
every new person to go and mint a Google app password before they could see
anything, it only worked for Gmail, and it needed outbound IMAP from a host
that often does not allow it.

So the proof moved to where it belongs: send a code to the address, and see
if they can read it.  That works for the @kernel.org, @amd.com, @redhat.com
and university addresses people actually sign patches with, and it asks for
nothing anybody has to go and create first.

What is kept, per person, in their own directory:

    account.json    name, username, gender, address, and the password as an
                    scrypt hash.  Never the password.
    vault.json      their API keys and settings, encrypted (see vault.py)

Sign-up itself is held in memory until it finishes.  A half-finished sign-up
is somebody's name and address with nothing proved about either, and the
worst place for that is a file on a disk that gets snapshotted.  It lives
for twenty minutes and then it is gone.
"""

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
from datetime import datetime, timezone

# Where the per-person directories live.  Set once, by the server.
PEOPLE = ""


def configure(people_dir: str) -> None:
    global PEOPLE
    PEOPLE = people_dir


def home_of(email: str) -> str:
    """One person's directory, named after a hash of their address.

    A listing of the disk is then not a list of who uses this server."""
    who = (email or "").strip().lower()
    return os.path.join(PEOPLE, hashlib.sha256(who.encode()).hexdigest()[:20])


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


# ---------------------------------------------------------------- passwords


# scrypt, with the parameters the RFC suggests for interactive use.  A
# password on the open internet is guessed at, and the only defence that
# survives a stolen file is making each guess expensive.
SCRYPT = dict(n=2 ** 15, r=8, p=1, dklen=32)

# OpenSSL caps scrypt at 32 MB unless asked otherwise, and these parameters
# want exactly that much, so it refuses by a single byte.  Ask for headroom.
SCRYPT_MAXMEM = 128 * SCRYPT["n"] * SCRYPT["r"] * 2


def hash_password(password: str, salt: bytes = b"") -> str:
    salt = salt or os.urandom(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt,
                            maxmem=SCRYPT_MAXMEM, **SCRYPT)
    return "scrypt$%s$%s" % (base64.b64encode(salt).decode(),
                             base64.b64encode(digest).decode())


def check_password(password: str, stored: str) -> bool:
    try:
        kind, salt_b64, want_b64 = stored.split("$")
        if kind != "scrypt":
            return False
        got = hashlib.scrypt(password.encode("utf-8"),
                             salt=base64.b64decode(salt_b64),
                             maxmem=SCRYPT_MAXMEM, **SCRYPT)
        return hmac.compare_digest(got, base64.b64decode(want_b64))
    except Exception:
        return False


# --------------------------------------------------------------- validation


# Every message here is addressed to the person typing, says what is wrong
# and what would be right, and never blames them for it.

MAX_NAME = 40
MAX_EMAIL = 254
GENDERS = ("male", "female", "other", "private")

# Names that would collide with a path, read as the server talking, or let
# somebody sign up as the deployment itself.
RESERVED = {
    "admin", "administrator", "root", "system", "patchvane", "mainline",
    "support", "help", "security", "abuse", "postmaster", "webmaster",
    "api", "login", "logout", "signup", "signin", "register", "account",
    "settings", "dashboard", "static", "assets", "null", "undefined", "me",
}

# Not a list of bad passwords -- that is what the composition rules are for.
# These are the ones that pass every rule and are still the first guess.
OBVIOUS = {"password1!", "passw0rd!", "p@ssw0rd", "p@ssword1", "welcome1!",
           "qwerty123!", "abcd1234!", "admin@123", "password@123",
           "changeme1!", "letmein1!"}

NAME_EXTRA = " '\u2019-."


def clean_name(raw: str) -> str:
    """Trim it and squeeze the spaces, so " hemanth  " and "hemanth" are one
    name and not two."""
    return re.sub(r"\s+", " ", (raw or "").strip())


def name_problem(raw: str, which: str) -> str:
    name = clean_name(raw)
    if not name:
        return "%s is required." % which
    if len(name) > MAX_NAME:
        return "%s is longer than %d characters." % (which, MAX_NAME)
    if not name[0].isalpha():
        return "%s has to start with a letter." % which
    # isalpha() and not a-z, because the people who send kernel patches are
    # called Kleine-König and Łukasz, and a form that cannot spell somebody's
    # name is a form that tells them they do not belong here.
    for ch in name:
        if not (ch.isalpha() or ch in NAME_EXTRA):
            return ("%s can have letters, spaces, hyphens and apostrophes. "
                    "\u201c%s\u201d is not one of those." % (which, ch))
    return ""


def clean_username(raw: str) -> str:
    return (raw or "").strip().lower()


def username_problem(raw: str) -> str:
    user = clean_username(raw)
    if not user:
        return "Username is required."
    if len(user) < 3:
        return "Usernames are at least 3 characters."
    if len(user) > 20:
        return "Usernames are at most 20 characters."
    if not user[0].isalpha():
        return "A username has to start with a letter."
    if not re.fullmatch(r"[a-z0-9_]+", user):
        return "A username can have letters, numbers and underscores only."
    if user in RESERVED:
        return "That username is reserved. Pick another."
    return ""


def clean_email(raw: str) -> str:
    return (raw or "").strip().lower()


def email_problem(raw: str) -> str:
    addr = clean_email(raw)
    if not addr:
        return "Email address is required."
    if len(addr) > MAX_EMAIL:
        return "That address is too long."
    if addr.count("@") != 1:
        return "An address has exactly one @ in it."
    local, _, host = addr.partition("@")
    if not local or not host:
        return "That does not look like a complete address."
    if not re.fullmatch(r"[a-z0-9!#$%&'*+/=?^_`{|}~.-]+", local):
        return "There is a character in that address that mail does not allow."
    if local.startswith(".") or local.endswith(".") or ".." in local:
        return "An address cannot start, end, or run two dots together."
    if "." not in host:
        return "The part after the @ needs a domain, like example.com."
    if not re.fullmatch(r"[a-z0-9.-]+", host) or host.startswith("-"):
        return "That domain does not look right."
    if not re.fullmatch(r"[a-z]{2,}", host.rsplit(".", 1)[1]):
        return "That domain does not end in something like .com or .org."
    return ""


def gender_problem(raw: str) -> str:
    if not (raw or "").strip():
        return "Please pick one, or choose not to say."
    if (raw or "").strip().lower() not in GENDERS:
        return "That is not one of the choices."
    return ""


def password_problem(password: str, username: str = "", email: str = "") -> str:
    pw = password or ""
    if len(pw) < 8:
        return "At least 8 characters."
    if len(pw) > 128:
        return "That is longer than 128 characters."
    if pw != pw.strip():
        return "It cannot start or end with a space."
    if not any(c.isupper() for c in pw):
        return "Add a capital letter."
    if not any(c.islower() for c in pw):
        return "Add a lowercase letter."
    if not any(c.isdigit() for c in pw):
        return "Add a number."
    if not any(not c.isalnum() and not c.isspace() for c in pw):
        return "Add a symbol, like ! ? @ # or -."
    low = pw.lower()
    if low in OBVIOUS:
        return "That is one of the first passwords anybody guesses."
    if username and len(username) > 2 and username.lower() in low:
        return "It should not contain your username."
    local = (email or "").split("@")[0].lower()
    if local and len(local) > 2 and local in low:
        return "It should not contain your email address."
    return ""


def password_strength(password: str) -> int:
    """0 to 4, for the bar under the field.  Length first, because it is what
    actually decides how long a guess takes."""
    pw = password or ""
    kinds = sum([any(c.isupper() for c in pw), any(c.islower() for c in pw),
                 any(c.isdigit() for c in pw),
                 any(not c.isalnum() and not c.isspace() for c in pw)])
    score = 0
    if len(pw) >= 8:
        score += 1
    if len(pw) >= 12:
        score += 1
    if len(pw) >= 16:
        score += 1
    if kinds >= 3:
        score += 1
    if kinds == 4 and len(pw) >= 10:
        score += 1
    return max(0, min(4, score))


# ------------------------------------------------------------ the record


LOCK = threading.Lock()
_INDEX = {}                     # username -> email, built from the disk
_INDEXED = False


def path_of(email: str) -> str:
    return os.path.join(home_of(email), "account.json")


def load(email: str) -> dict:
    """One account, or an empty dict if there is no such person."""
    if not email:
        return {}
    try:
        with open(path_of(email), encoding="utf-8") as fh:
            rec = json.load(fh)
        return rec if isinstance(rec, dict) and rec.get("email") else {}
    except (OSError, ValueError):
        return {}


def save(rec: dict) -> bool:
    """Write an account, readable only by the account running this."""
    email = clean_email(rec.get("email", ""))
    if not email:
        return False
    home = home_of(email)
    path = os.path.join(home, "account.json")
    tmp = path + ".tmp"
    try:
        os.makedirs(home, exist_ok=True)
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(rec, fh, ensure_ascii=False, indent=1)
        os.replace(tmp, path)
    except OSError:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        return False
    with LOCK:
        _INDEX[rec.get("username", "")] = email
    return True


def _build_index() -> dict:
    """Usernames to addresses, read off the disk.

    There is no file listing them: the index is rebuilt by walking the
    directories, so nothing on disk is a plain list of everybody here, and a
    directory restored from a snapshot is picked up without a migration."""
    found = {}
    for name in sorted(os.listdir(PEOPLE)) if os.path.isdir(PEOPLE) else []:
        try:
            with open(os.path.join(PEOPLE, name, "account.json"),
                      encoding="utf-8") as fh:
                rec = json.load(fh)
        except (OSError, ValueError):
            continue
        if rec.get("username") and rec.get("email"):
            found[rec["username"]] = rec["email"]
    return found


def index() -> dict:
    global _INDEXED
    with LOCK:
        if not _INDEXED:
            _INDEX.clear()
            _INDEX.update(_build_index())
            _INDEXED = True
        return dict(_INDEX)


def refresh() -> None:
    global _INDEXED
    with LOCK:
        _INDEXED = False


def by_username(username: str) -> dict:
    user = clean_username(username)
    email = index().get(user, "")
    return load(email) if email else {}


def by_email(email: str) -> dict:
    return load(clean_email(email))


def find(who: str) -> dict:
    """Whoever this is, however they typed it.  The sign-in box takes one
    field, because being asked to remember which of the two you used is a
    worse experience than the server working it out."""
    who = (who or "").strip()
    return by_email(who) if "@" in who else by_username(who)


def username_taken(username: str, except_email: str = "") -> bool:
    email = index().get(clean_username(username), "")
    return bool(email) and email != clean_email(except_email)


def email_taken(email: str) -> bool:
    return bool(load(clean_email(email)).get("password"))


def count() -> int:
    return len(index())


def create(email: str, username: str, first: str, last: str, gender: str,
           password: str) -> dict:
    """A new account, verified and ready to sign in with."""
    rec = {
        "email": clean_email(email),
        "username": clean_username(username),
        "first": clean_name(first),
        "last": clean_name(last),
        "gender": (gender or "private").strip().lower(),
        "created": now_iso(),
        "verified": now_iso(),
        "password": hash_password(password),
        "password_set": now_iso(),
        "last_login": "",
    }
    return rec if save(rec) else {}


def set_password(email: str, password: str) -> bool:
    rec = load(email)
    if not rec:
        return False
    rec["password"] = hash_password(password)
    rec["password_set"] = now_iso()
    return save(rec)


def sign_in(who: str, password: str) -> tuple:
    """(account, why not).  One message for both halves being wrong, because
    a different one for "no such user" is a way to ask this server which
    addresses have accounts here."""
    rec = find(who)
    stored = rec.get("password") or ""
    if not stored:
        # Still spend the time.  Answering a name that does not exist faster
        # than one that does is the same disclosure by another route.
        hash_password(password or "x")
        return {}, "That username or password is not right."
    if not check_password(password or "", stored):
        return {}, "That username or password is not right."
    rec["last_login"] = now_iso()
    save(rec)
    return rec, ""


def display(rec: dict) -> dict:
    """What the dashboard is allowed to know about whoever is signed in."""
    if not rec:
        return {}
    return {"email": rec.get("email", ""), "username": rec.get("username", ""),
            "first": rec.get("first", ""), "last": rec.get("last", ""),
            "name": " ".join(filter(None, [rec.get("first", ""),
                                           rec.get("last", "")])),
            "gender": rec.get("gender", "private"),
            "since": rec.get("created", "")}


# ------------------------------------------------------- codes, in memory


CODE_MINUTES = 10           # how long one code is good for
FLOW_MINUTES = 25           # how long the whole sign-up may take
MAX_TRIES = 5               # wrong codes before the flow is torn down
RESEND_SECONDS = 60         # between one send and the next
MAX_STARTS = 5              # flows one address may start in an hour
START_WINDOW = 3600

# A code is held as an HMAC under a key this process made and never writes
# down, so a heap dump is not a list of live codes.
_CODE_KEY = secrets.token_bytes(32)

FLOWS = {}
STARTS = {}
FLOW_LOCK = threading.Lock()


def _digest(code: str) -> bytes:
    return hmac.new(_CODE_KEY, code.encode(), hashlib.sha256).digest()


def _sweep(now: float) -> None:
    for token in [t for t, f in FLOWS.items()
                  if now - f["made"] > FLOW_MINUTES * 60]:
        del FLOWS[token]
    for who in [w for w, when in STARTS.items()
                if not [t for t in when if now - t < START_WINDOW]]:
        del STARTS[who]


def start(kind: str, email: str, data: dict = None) -> tuple:
    """Begin a sign-up or a reset.  Returns (token, code, why not).

    The caller sends the code; nothing here touches the network."""
    email = clean_email(email)
    now = time.time()
    with FLOW_LOCK:
        _sweep(now)
        recent = [t for t in STARTS.get(email, []) if now - t < START_WINDOW]
        if len(recent) >= MAX_STARTS:
            return "", "", ("That address has been sent several codes already. "
                            "Try again in an hour.")
        recent.append(now)
        STARTS[email] = recent
        token = secrets.token_urlsafe(24)
        code = "%06d" % secrets.randbelow(1000000)
        FLOWS[token] = {"kind": kind, "email": email, "data": dict(data or {}),
                        "code": _digest(code), "made": now, "sent": now,
                        "tries": 0, "verified": False}
    return token, code, ""


def flow(token: str) -> dict:
    with FLOW_LOCK:
        _sweep(time.time())
        return FLOWS.get(token or "", {})


def resend(token: str) -> tuple:
    """A fresh code for a flow already under way.  (code, why not)."""
    now = time.time()
    with FLOW_LOCK:
        _sweep(now)
        f = FLOWS.get(token or "")
        if not f:
            return "", "That took too long. Start again."
        left = int(RESEND_SECONDS - (now - f["sent"]))
        if left > 0:
            return "", "Another code can be sent in %d seconds." % left
        code = "%06d" % secrets.randbelow(1000000)
        f.update(code=_digest(code), sent=now, tries=0, verified=False)
    return code, ""


def check(token: str, code: str) -> str:
    """Empty string when the code was right.  Otherwise what to say."""
    typed = re.sub(r"\D", "", code or "")
    with FLOW_LOCK:
        _sweep(time.time())
        f = FLOWS.get(token or "")
        if not f:
            return "That took too long. Start again."
        if time.time() - f["sent"] > CODE_MINUTES * 60:
            return "That code has expired. Ask for a new one."
        if f["tries"] >= MAX_TRIES:
            del FLOWS[token]
            return "Too many wrong codes. Start again."
        if len(typed) != 6 or not hmac.compare_digest(_digest(typed), f["code"]):
            f["tries"] += 1
            left = MAX_TRIES - f["tries"]
            if left <= 0:
                del FLOWS[token]
                return "Too many wrong codes. Start again."
            return ("That code is not right. %d %s left."
                    % (left, "try" if left == 1 else "tries"))
        f["verified"] = True
        # Proving the address is a separate step from choosing a password,
        # and the second one is allowed to take a minute.
        f["sent"] = time.time()
    return ""


def finish(token: str) -> dict:
    """Take the flow away and hand back what it was carrying."""
    with FLOW_LOCK:
        return FLOWS.pop(token or "", {})
