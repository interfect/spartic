# Spartic: Anonymous Small-Group Communication Without Forwarding

**Spartic** provides a way for small groups of people to create virtual spaces
where nobody either in or outside the group can know who is who.

Any message exchanged in such a space could have come from any participant;
only the content of the message can provide any clue to the sender's identity.

Unlike systems such as Tor, which achieve anonymity by forwarding traffic, in
Spartic all participants carry only their own messages.

Spartic achieves its anonymity through *synchronized keystreams*: the
participants in a group are able to create random strings of bits that, while
unpredictable, are guaranteed to XOR to zero when all combined. Each
participant publishes their stream to all other participants, with their
messages XORed in. By XORing the streams they received with the one they sent,
each participant can recover a stream containing all the (nonoverlapping)
messages, but no participant can identify any other participant as having sent
any particular message.

If the parties coordinate perfectly on which pseudonym within the system is
allowed to write to any given bit, then for N parties sending B bits of content
from one party to another, an additonal (N - 1) * B bits of overheadare
required. (More overhead may be required for re-keying faster than information
leaks form the synchronized keystreams' secrets.)

To avoid parties being identified because they sent packets first, it is
recommended to schedule the transmission of bits at a predefined rate, and for
changes to that rate to be negotiated within the virtual space.
