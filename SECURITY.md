# Security

## Reporting something

Please do not open a public issue for a vulnerability.

Use GitHub's private reporting, on the **Security** tab of this repository,
under *Report a vulnerability*. That opens a thread only you and the
maintainer can read. If it is not available, write to
<hemanth.selam@gmail.com> with `patchvane` in the subject.

Say what you found, what it lets somebody do, and how to reproduce it. A
patch is welcome but not expected. You will get an acknowledgement within a
week, and an honest answer about whether and when it will be fixed.

Only `main` is supported. There are no releases to back-port to.

## What there is to protect

Patchvane is usually run by one person on `127.0.0.1`, but it is written so
that one server can collect for several people, and that is where the
interesting boundaries are.

**A password** is what you sign in with. `people/<address>/account.json`,
mode 0600, holds an scrypt hash of it and nothing that can be turned back
into it. It is never logged, and never put in an email — not in the welcome
one either, because a password in a mailbox is a password in every backup of
that mailbox.

**A one-time code** is what proves an address belongs to whoever typed it.
Six digits, good for ten minutes and one use, held as an HMAC under a key the
process makes at start-up and never writes down, five wrong answers before
the sign-up is torn down. The half-finished sign-up it belongs to lives in
memory only: a name and an address with nothing proved about either is not
something to put on a disk that gets snapshotted.

**API keys for the assistant** are kept per person, in
`people/<address>/vault.json`, mode 0600, sealed with a key derived from the
server's own `PATCHVANE_SECRET`. One signed-in person must not be able to
read another's keys, and a copy of the disk must not be a list of everybody's.

That sealing is hand-built, and you should know it before you rely on it.
The project takes no dependencies and the standard library has no AES, so
`src/vault.py` uses an HMAC-SHA256 keystream in the shape of AES-CTR, with
encrypt-then-MAC over the result. The reasoning is written out at the top of
that file. It is the kind of construction that is worth a second pair of
eyes, and a report about it is a report worth having.

**Sessions** are stateless signed cookies. Nothing is kept server side, so
there is no session store to steal. `PATCHVANE_SECRET` signs them, has to be
at least 32 characters, and the server refuses to start without one. A
restart rolls the epoch and signs everybody out, unless
`PATCHVANE_SESSION_EPOCH` is set by hand.

**Outbound mail** goes through one provider's HTTPS API, carrying an address,
a name and a code. `src/mailer.py` is the only thing here that sends anything
anywhere, and it only sends to an address somebody has just typed into the
sign-up or reset form.

**What is sent to a model**, when the assistant is used, is narrowed first:
`src/redact.py` masks reviewer addresses before anything leaves the machine, and
`PATCHVANE_PRIVACY` can withhold private notes and message excerpts as well.

## Limits that are deliberate, not bugs

- The running server has to decrypt API keys in order to use them, so
  anything with the run-time memory of the process has the keys. No design
  that keeps a usable key on a machine can claim otherwise.
- Binding to `0.0.0.0` puts an unencrypted dashboard on the network. That is
  a choice for you to make and the README says so where it suggests it.
- Patchvane only ever reads the public archives. It posts nothing to any
  mailing list and writes nothing back, so a bug here cannot send mail in
  your name.
