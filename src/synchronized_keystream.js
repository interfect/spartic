import crypto from 'hypercore-crypto'
import xsalsa20 from 'xsalsa20'
import b4a from 'b4a'

/**
 * Represents one of a collection of "synchronized" keystreams. The keystreams
 * in a synchronized collection have the property that, for corresponding bits
 * in all keystreams in the set, the total parity is zero.
 *
 * For example, if there are four synchronized keystreams A, B, C, and D, for
 * any given bit index, only the following combinations are possible:
 *
 * A B C D
 * 0 0 0 0
 * 0 0 1 1
 * 0 1 0 1
 * 0 1 1 0
 * 1 0 0 1
 * 1 0 1 0
 * 1 1 0 0
 * 1 1 1 1
 *
 * The other possible 4-bit patterns are disallowed because they have an odd
 * number of 1-bits. 
 *
 * Because synchronized keystreams have this property, data XORed with one
 * keystream to encrypt it can be decrypted by XORing it with the output of all
 * of the other keystreams in its synchronized collection.
 *
 * This works on a per-bit basis: all parties can share with each other their
 * keystreams XORed with a sparse stream of data (which is mostly zeroes).
 * XORing all *those* streams together will produce a stream that is all zeroes
 * *except* at the points where *an odd number* of parties have XORed in 1
 * bits, where it will be 1. If the parties coordinate (via collision-detection
 * or some other contention-controll scheme) so that only one party writes data
 * on any given bit, then each party can send data to the others without being
 * identified as the data's source.
 *
 * This anonymization scheme does not rely on traffic forwarding or onion
 * routing, and thus sidesteps the moderation concerns involved in forwarding
 * traffic for others.
 *
 * For this to work, each party needs to be able to generate a keystream that
 * it knows is synchronized with those of all of the other parties, but which
 * is also not predictable by any of the other parties, and ideally not
 * predictable by subsets of less than all of the other parties working
 * together. This is accomplished by having each pair of parties share a
 * standard stream cypher keystream; each party's synchronized keystream is the
 * XOR of all the pairwise keystreams they have. Since each pairwise keystream
 * gets XORed into two parties streams, the streams are all synchronized.
 */
export default class SynchronizedKeystream {
  
  /// How big are the secrets that need to be shared?
  static get SECRET_SIZE() {
    return 32
  }

  /// Make a new SynchronizedKeystream using the given list of shared secrets
  /// with each of the other parties. Each shared secret must be a 32-byte
  /// buffer.
  constructor(shared_secrets) {
    this.keys = shared_secrets.slice(0, shared_secrets.length)
  }
  
  /// Read a block of data from our keystream, with the given sequence number and length.
  /// We always get the same data for a given sequence number; don't re-use it!
  read(sequence_number, length) {
    // TODO: We could just keep some xsalsa20 objects around and not have to
    // worry about sequence numbers. But then we couldn't ever resume I think?
  
    // Make the buffer we will do all our XORing in. Starts as 0.
    let scratch = b4a.alloc(length)
    
    // Prepare the nonce (same for all streams)
    // TODO: support more than 53-bit sequence numbers?
    let nonce = b4a.alloc(xsalsa20.NONCEBYTES)
    nonce.writeUInt32BE(sequence_number >> 32, 0)
    nonce.writeUInt32BE(sequence_number & 0xFFFFFFFF, 4)
    
    for (let key of this.keys) {
      // XOR what we have so far with each shared keystream
      let stream = xsalsa20(nonce, key)
      scratch = stream.update(scratch)
      stream.finalize()
    }
    
    return scratch
  }
}
