import Hyperswarm from 'hyperswarm'
import crypto from 'hypercore-crypto'

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
 * number of 1-bits. The number of possible bit patterns for N synchronized
 * streams is:
 *
 * \sum_i=0^N/2 {N \choose i*2}
 *
 * For 4 participants, there are 8 patterns. For 6 participants, there are 32.
 * For 8 participants, there are 128. Note that the number of patterns is
 * conveniently a power of two, so they can be numbered with binary numbers of
 * a certain length without any unused numbers.
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
 * together. To accomplish this, we propose a scheme that starts with
 * synchronized but fully predictable keystreams, and makes them unpredictable
 * while retaining synchronization by a series of conditional swaps.
 *
 * First, the parties number themselves. Each party computes the list of
 * possible bit patterns for all of the streams, in a canonical order, and
 * pulls out its column. It then constructs a function that maps from the low
 * bits of a uniform random "state" bit vector to a row in that party's column
 * of the canonical list of combinations, and thus to a bit value (0 or 1). It
 * is important that 0 and 1 are equally likely for all participants, which is
 * easy when the number of possible bit patterns is a power of two, since some
 * number of the low bits of the state can be used to map into the list of
 * possible patterns directly.
 *
 * At this point, for any state, all parties can compute a synchronized set of
 * bits: most of the bits in the state are ignored, and the low bits choose a
 * possible pattern from the canonical list, and then each party emits their
 * assigned bit, guaranteeing the parity constraint that defines
 * synchronization. The task is then to prevent each party from being able to
 * predict what bit each of the other parties will emit, without changing the
 * total parity.
 *
 * To do this, we add a mechanism for pairs of parties to agree on "swaps" with
 * each other where, conditioned on the value of some bit in the state vector,
 * they both agree to flip their emitted bits, which preserves parity but makes
 * their emitted bits harder to predict. If one party would have emitted 1 but
 * the other 0, they actually swap, while if both would have emitted 1 or both
 * 0, they both flip and emit the other value.
 
 * The set of swaps between two parties is a shared secret that they know but
 * the other parties do not, even collectively. The only people who know the
 * full set of swaps that a party is participating in is that party, or a set
 * of all other parties colluding.
 *
 * The net effect of a set of swaps can be represented by a bit vector the same
 * length as the state. If a bit is set in the vector, then the party has
 * agreed to an odd number of swaps conditioned on that bit, while if it is 0
 * they have agreed to an even number of swaps conditioned on that bit (or no
 * swaps). Agreeing to a swap conditioned on a bit results in toggling that
 * bit.
 *
 * We allow each party to unilaterally determine and send each other party a
 * list of swaps (again in the form of a bit vector) that the other party will
 * agree to. That bit vector will get XORed into the swap state. As long as a
 * given party generates a cryptographically-strong set of swaps to propose to
 * each other participant, and the other participants do not all collude, the
 * set of swaps that that party is actually using will be cryptographically
 * strong and not known to anyone else, and therefore nobody will be able to
 * predict the participant's keystream.
 */
class SynchronizedKeystream {
}


/// How long are crypto key seeds?
export const SEED_SIZE = 32

/// Turn a buffer into a hex string
function key_to_string(key) {
  return key.toString("hex")
}

/// Turn a buffer into a short hex string
function key_to_name(key) {
  return key.slice(0, 4).toString("hex")
}

/**
 * Main peer class.
 *
 * Takes care of receiving messages and doing the right thing with them according to the state.
 */
export class SparticPeer extends Hyperswarm {
  /// Make a new SparticPeer.
  /// Takes options defined for a Hyperswarm, such as a 32-byte buffer "seed"
  /// for making the private key.
  constructor(options) {
    super(options)
    this.log('My public key is ', this.keyPair.publicKey)
    
    this.on('connection', (conn, info) => {
      this.log('Connected to: ', key_to_name(info.publicKey))
      conn.on('data', (data) => {
        this.log('<-', '(' + key_to_name(info.publicKey) + ')', data.toString())
      })
      conn.write('Hello peer!')
    })
    
  }
  
  /// Get a short name for this peer defined by its key
  getName() {
    return key_to_name(this.keyPair.publicKey)
  }
  
  /// Log a message to the console, noting it came from this peer
  log(...args) {
    console.log('(' + this.getName() + ')', ...args)
  }

}

