# Spectra and the local worker

## Implemented

The worker is a program on the same computer as the person running it. It listens on `127.0.0.1` and reads one URL from a local HTTP POST. `compare.py` calls the library in-process. Nothing in the Spectra web app imports this package. Hosted Spectra does not know the worker exists.

## Not implemented, and not possible as a server-side call

A Spectra deployment on Vercel cannot open `http://127.0.0.1` on the visitor's computer. That address is the server's own loopback, not the user's. A public hostname, tunnel, or inbound port on the user's machine would expose the worker. This prototype does not add any of those.

## Proposed, if a later change is reviewed separately

Local pull, still without a public listener:

1. The hosted app stores a job the signed-in user asked for (the URL and the mode). It does not fetch the user's machine.
2. A program the user starts on their computer polls the hosted app over outbound HTTPS, takes one job, runs this worker on `127.0.0.1`, and posts the text back.
3. The laptop never accepts a connection from the internet. The hosted app never dials a private address.

That client is not in this pull request. There is no token, queue, or production switch for it.

Until that exists, the only supported use is local: run `worker.py` or `compare.py` on a machine you control, against public URLs, and read the JSON yourself.

## Relation to PR 8

PR 8 changes the search cascade in `src/`. This PR only adds `workers/scrapling/` and is based on `main`, so the two diffs do not edit the same files. They can be reviewed separately. Merging both would still leave the website unable to call the worker, which is the intended gap until a pull client is designed and reviewed on its own.
