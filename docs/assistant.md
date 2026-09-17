# The assistant

Adding a model, what it is asked, and what leaves the machine.

**Settings → Assistant** lists every model the dashboard can talk to. Add an
API key for any of them and it becomes available:

| | Key from | Environment variable |
|---|---|---|
| OpenAI | `platform.openai.com/api-keys` | `OPENAI_API_KEY` |
| Claude | `console.anthropic.com/settings/keys` | `ANTHROPIC_API_KEY` |
| Gemini | `aistudio.google.com/apikey` | `GEMINI_API_KEY` |
| Grok | `console.x.ai` | `XAI_API_KEY` |
| DeepSeek | `platform.deepseek.com` | `DEEPSEEK_API_KEY` |
| Mistral | `console.mistral.ai` | `MISTRAL_API_KEY` |
| Groq | `console.groq.com/keys` | `GROQ_API_KEY` |
| OpenRouter | `openrouter.ai/keys` | `OPENROUTER_API_KEY` |
| Perplexity | `perplexity.ai/settings/api` | `PERPLEXITY_API_KEY` |
| Cohere | `dashboard.cohere.com/api-keys` | `COHERE_API_KEY` |
| Together AI | `api.together.ai` | `TOGETHER_API_KEY` |
| Fireworks | `fireworks.ai/account/api-keys` | `FIREWORKS_API_KEY` |
| Cerebras | `cloud.cerebras.ai` | `CEREBRAS_API_KEY` |
| NVIDIA NIM | `build.nvidia.com` | `NVIDIA_API_KEY` |
| SambaNova | `cloud.sambanova.ai` | `SAMBANOVA_API_KEY` |
| Moonshot (Kimi) | `platform.moonshot.ai` | `MOONSHOT_API_KEY` |
| Z.ai (GLM) | `z.ai/manage-apikey/apikey-list` | `ZHIPU_API_KEY` |
| Qwen | `bailian.console.alibabacloud.com` | `DASHSCOPE_API_KEY` |
| Hugging Face | `huggingface.co/settings/tokens` | `HF_TOKEN` |
| Azure OpenAI | `portal.azure.com` | `AZURE_OPENAI_API_KEY` |

One key is enough; the rest stay folded away until you go looking. The
environment wins over anything typed into the page, so a deployment can pin a
key the page cannot replace. **Test** on each card does one cheap round trip
and tells you whether the key works.

Azure gives every deployment its own hostname, so it also needs
`ai.endpoints.azure` in `config.json` pointing at yours. The same setting
works for anything else behind a company gateway.

## Asking it things

It is a conversation, not a row of unrelated questions. Each question goes to
the model with the dozen turns before it, so a follow-up can leave its subject
out the way people do: ask what a maintainer's reply means, then "what should
I say back", then "and the hyperv one?", and each lands where you meant it.
Anything you tell it that the dashboard does not know, such as a request made
off-list, it takes at its word for the rest of the conversation.

Every question also carries a digest of the whole contribution: the totals, the
trees, what landed, the threads waiting on you, and one line per patch. That is
enough for "how many" and "where does this stand", and not enough for "what did
the reviewer ask me to change", because the asking happened in a message a
summary has no room for. So the threads your question is about are looked up
and quoted in full underneath it: every version, and every reply with who wrote
it. Ask what to change in the next spin and it answers from what the reviewer
actually wrote.

Your own notes are in the digest too, which is worth remembering when the
answer cites a rule you wrote down somewhere else.

## Picking a model

The assistant has a picker next to the message box. On **Auto** the question
is read for what kind of question it is, and the models suited to it go
first:

| The question is about | Asked in this order |
|---|---|
| code, diffs, build failures | Claude, DeepSeek, OpenAI, Gemini |
| drafting a reply | Claude, OpenAI, Gemini |
| working something out | OpenAI, Claude, Gemini, Grok |
| counting and listing | Gemini, OpenAI, Groq, Claude |

Models with no key are skipped. If one is rate limited or overloaded it is
asked once more after a short pause, and then the question moves to the next
model; the answer says who ended up giving it, and who could not. Choosing a
model by name pins it to the front of that order without turning it into a
single point of failure.

## Reading the threads

A patch's status comes from three kinds of evidence, and they are not equally
trustworthy:

1. **A commit in a tree.** A fact. Never questioned.
2. **A state somebody set in patchwork.** Nearly always right, but it goes
   wrong in one particular way: a patch sent to one subsystem gets picked up
   by another subsystem's patchwork instance and marked `not-applicable`
   there, while the maintainer who owns the code is busy applying it. A
   sched_ext patch caught by netdev's patchwork looks rejected when Tejun
   has already taken it.
3. **A maintainer writing in English.** Read with regular expressions, which
   handle "Applied, thanks" and miss "I've taken this into my tree for the
   next merge window" or "please send this via net-next instead".

If a key is configured, the collector asks a model about the third kind, and
about the second kind when somebody in the thread says they took the patch.
It sees the whole history: every version, what each was told, and what was
said on the series cover letter, which is where "Applied 1-2 to
sched_ext/for-7.4" usually arrives.

It may only answer with a status the dashboard already knows, an unrecognised
answer is discarded, and every status decided this way carries a `READ` badge
in the patch list so a reading is never mistaken for a record.
**Settings → Assistant** shows how many came from each. Answers are cached
against the thread's contents, so a collection only asks about threads that
gained a reply, a version or a new patchwork state.

`src/collect.py --no-ai` turns it off; so does having no key, in which case the
regular expressions have the final word as before. `ai.classify_limit` in
`config.json` caps how many threads one collection may ask about.

## Versions of the same patch

Resending a patch as v2 does not create a second patch. Every version is
matched by subject, and the newest one speaks for the work: earlier ones read
as *superseded*, saying which version replaced them. This matters for the
totals — without it an abandoned v1 sits in "no reply yet" for ever.

A commit is credited to the version that was actually applied, worked out
from the date: the newest version sent before the commit was made. Without
that, one accepted patch is counted once per version that shares its subject.
A version that genuinely landed keeps its commit even if a later one was
sent.

## Whose commit it is

Being named on a thread is not the same as having written the patch, and the
difference is where a tracker like this quietly goes wrong. Three checks keep
a commit from being credited to the wrong person:

- git.kernel.org is asked for commits by your address, and the answer is
  checked rather than trusted: the log carries an author column, and a row
  authored by somebody else is dropped however it came back.
- A maintainer replying "applied, thanks" is only believed when the patch
  they are applying is one you posted. Threads carry other people's series —
  ones you were copied on, ones you reviewed — and the reply in those is
  about their work, not yours.
- A commit whose subject was reworded on the way in is still matched to the
  patch it came from, but only on a distinctive prefix, cut at a word
  boundary, and only when exactly one patch matches. Two candidates mean it
  cannot be told which, and it is left uncredited rather than guessed.

Patches counted this way carry the author the commit was actually written
under, so a wrong one is visible rather than silent.

## When a source cannot be reached

If git.kernel.org does not answer, the collector keeps the last answer it got
rather than reporting no commits, because "no commits" silently moves every
merged patch back to unmerged. When that happens the page says so, on the
overview and under the timestamp, naming the host it could not reach.

## What is sent

Every question goes out with a digest of what the dashboard collected:
totals, per tree numbers, landed commits, open threads, review tags, your
notes, and a one line summary of each patch. That is around fifty kilobytes.
No mail bodies, no credentials and no patch contents leave the machine.
Reviewer addresses are masked first. The model is told to answer only from
the digest and to say so when the answer is not in there.

Useful things to ask:

- What needs my attention today?
- Which series are stuck and why?
- What should change in v2 of this series?
- Summarise the review feedback I have received.
- Which trees have accepted the most of my work?

## Your key is yours

A key you add is yours alone. It is written into your own vault under
`people/`, encrypted with the server's secret, mode `0600`, and it is only
ever spent on your questions and your collections. Somebody else signing in
to the same server is asked for their own; they are never quietly handed
yours, and they cannot read it.

Tick "remember this" and the key survives a restart. Leave it and it lives in
memory until the server stops. Either way, nothing about it reaches another
account.

The encryption covers the key where it sits: a stolen disk, a stray backup or
a copied directory gives up nothing without `PATCHVANE_SECRET`. It cannot
cover the running server, which has to decrypt the key in order to use it.
Nothing that keeps a usable key on a machine can claim otherwise.

If a model you picked stops existing, and providers retire them often, press
**Test** in Settings. It finds one on your key that does answer and moves you
onto it rather than leaving you with a dead setting.

An operator who would rather supply one set of keys for everybody can set
`PATCHVANE_SHARED_KEYS=1`, and then a key in the environment fills in for
anyone who has not added their own. It is off by default.
