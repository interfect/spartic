import SynchronizedKeystream from './synchronized_keystream.js'
import crypto from 'hypercore-crypto'
import buffer_xor from 'buffer-xor'
import xor_all from './xor_all.js'

/**
 * Represents a SparticPeer's membership in a ring.
 *
 * Has messages passed to it via incoming calls.
 * Determines and queues internally the messages it wants to send.
 * Then has messages it wants to send queries from it.
 *
 * MUST be protected from messages from peers not in the ring.
 *
 * To talk to the ring, use readyToParticipate() and participateInRound() to
 * feed in the data you want to post (or zeroes), and popResult() to get back
 * the result blocks with everyone's posted data.
 *
 * TODO: To do collision detection we need to match up the results with what we
 * sent on what round.
 */
export default class SparticSession {

  /// How long are the blocks in each round?
  static get BLOCK_SIZE() {
    return 4096
  }

  /// Make a new SparticSession, given the public keys of the other
  /// participants.
  constructor(otherPubkeys) {
    // Remember all the public keys
    this.otherPubkeys = otherPubkeys
    
    // To establish shared keys, we send each peer a key and receive a key from
    // each. Then we can start round 0.
    this.ourSharedKeys = new Map()
    for (let pubkey of this.otherPubkeys) {
      this.ourSharedKeys.set(pubkey, crypto.randomBytes(SynchronizedKeystream.SECRET_SIZE))
    }
    
    // When we get the ones from the other peers we put them in here.
    this.theirSharedKeys = new Map() 
    for (let pubkey of this.otherPubkeys) {
      // Make slots for all the keys we expect
      this.theirSharedKeys.set(pubkey, null)
    }


    // We use these round objects to manage how we might start getting blocks
    // from the next round before we send our block for the next round or have
    // all the blocks for the current round. We never let things get more than
    // 1 round ahead.
    this.currentRound = null
    this.nextRound = {
      sequenceNumber: 0,
      theirBlocks: {},
      ourBlock: null
    }

    // Holds queued messages for each other peer.
    // Messages are either ['key', shared key]
    // Or ['block', sequence number, block]
    // Or ['error', message] 
    this.queues = new Map()
    for (let pubkey of this.otherPubkeys) {
      this.queues.set(pubkey, [])
    }

    // Holds the finished decoded messages for completed rounds until they can
    // be retrieved
    this.results = []

    this.sendKeys()
  }
  
  /// Report the status of the session as a human-readable string
  getStatus() {
    if (this.keystream) {
      if (!this.currentRound) {
        return 'SETUP: Not in a round'
      }
      if (this.currentRound.ourBlock) {
        return 'RUNNING: In round ' + this.currentRound.sequenceNumber + ', block created, ' + this.results.length + ' results available'
      } else {
        return 'RUNNING: In round ' + this.currentRound.sequenceNumber + ', block needed, ' + this.results.length + ' results available'
      }
    } else {
      let missingPeers = 0
      for (let pubkey of this.otherPubkeys) {
        if (!this.theirSharedKeys.get(pubkey)) {
          missingPeers++
        }
      }
      return 'SETUP: Awaiting shared keys from ' + missingPeers + ' peers'
    }
  }

  /// Send our half of the shared keys to all the peers
  sendKeys() {
    // Start out by telling everyone else our key
    for (let pubkey of this.otherPubkeys) {
      this.queues.get(pubkey).push(['key', this.ourSharedKeys.get(pubkey)])
    }
  }

  /// Handle receipt of a shared key from a peer
  receiveKey(pubkey, sharedKey) {
    console.log('Got a shared key')
    if (this.theirSharedKeys.get(pubkey)) {
      // We already have a key, so complain
      this.queues.get(pubkey).push(['error', 'public key already received'])
      return
    }
    // Store the key
    this.theirSharedKeys.set(pubkey, sharedKey)
    let missingKeys = 0
    for (let pubkey of this.otherPubkeys) {
      if (!this.theirSharedKeys.get(pubkey)) {
        missingKeys++
      }
    }
    if (missingKeys > 0) {
      console.log('Still missing ' + missingKeys + ' shared keys')
      return
    }
    // Now we are the last key to arrive.
    
    // Make a list of all the keys
    secrets = []
    for (let pubkey of this.otherPubkeys) {
      secrets.push(this.ourSharedKeys.get(pubkey))
      secrets.push(this.theirSharedKeys.get(pubkey))
    }

    // Prepare the keystream
    console.log('Got all shared keys; Setting up SynchronizedKeystream')
    this.keystream = new SynchronizedKeystream(secrets)

    // Advance to first round
    this.advanceRound()
  }

  /// Handle receipt of a block with a sequence number from a peer
  receiveBlock(pubkey, sequenceNumber, block) {
    if (this.currentRound && sequenceNumber == this.currentRound.sequenceNumber) {
      this.receiveBlockForRound(pubkey, block, this.currentRound)
    } else if (this.nextRound && sequenceNumber == this.nextRound.sequenceNumber) {
      this.receiveBlockForRound(pubkey, block, this.nextRound)
    } else {
      this.queues.get(pubkey).push(['error', 'block is for an unacceptable round'])
      return
    }
    
    if (this.currentRound) {
      // See if the current round is done
      if (!this.currentRound.ourBlock) {
        // Not done because we haven't done our block yet
        return
      }
      for (let pubkey of this.otherPubkeys) {
        if (!this.theirBlocks[pubkey]) {
          // Not done because we are missing this peer
          return
        }
      }
      // We are done!
      this.advanceRound()
    }
  }

  /// Handle receipt of a block that belongs in the given round
  receiveBlockForRound(pubkey, block, round) {
    if (round.theirBlocks[pubkey]) {
      this.queues.get(pubkey).push(['error', 'block is already here'])
      return
    }
    if (block.length != this.prototype.BLOCK_SIZE) {
      this.queues.get(pubkey).push(['error', 'block is the wrong size'])
      return
    }
    round.theirBlocks[pubkey] = block
  }

  /// Compute the result of the current round and start the next round 
  advanceRound() {
    if (this.currentRound) {
      // Handle the finished round.
      // Start with our block
      blocks = [this.currentRound.ourBlock]
      for (let pubkey of this.otherPubkeys) {
        // Collect all their blocks
        blocks.push(this.currentRound.theirBlocks[pubkey])
      }
      // Do the XOR and keep the result
      this.results.push(xor_all(blocks))
    }

    // Swap the round buffers
    this.currentRound = this.nextRound
    this.nextRound = {
      sequenceNumber: this.currentRound.sequenceNumber + 1,
      theirBlocks: {},
      ourBlock: null
    }

    // New current round can't also be ready since we need to generate a block still.
  }

  /// Write the given data (possibly all 0) and generate our block for the current round
  participateInRound(messageBuffer) {
    if (messageBuffer.length != this.constructor.BLOCK_SIZE) {
      throw new Error('Message to send is the wrong length')
    }
    if (!this.currentRound) {
      throw new Error('No round is in progress; cannot send message')
    }
    if (this.currentRound.ourBlock) {
      throw new Error('Message already sent this round; cannot send message')
    }
    // Read the keystream and do the xor to set the block for the round
    this.currentRound.ourBlock = buffer_xor(this.keystream.read(this.sequenceNumber, this.constructor.BLOCK_SIZE), messageBuffer)

    for (let pubkey of this.otherPubkeys) {
      // And tell everyone about it
      this.queues.get(pubkey).push(['block', this.currentRound.sequenceNumber, this.currentRound.ourBlock])
    }
  }

  /// Returns true if we are ready to participate in the current round
  readyToParticipate() {
    if (!this.currentRound) {
      return false
    }
    if (this.currentRound.ourBlock) {
      return false
    }
    return true
  }

  /// Get the next queued message for the given peer pubkey, or null
  /// Message is:
  /// ['error', message] | ['block', sequenceNumber, data] | ['key', sharedKey]
  popMessage(pubkey) {
    if (this.queues.get(pubkey).length > 0) {
      return this.queues.get(pubkey).shift()
    } else {
      return null
    }
  }

  /// Get the next finished result, or null
  popResult() {
    if (this.results.length > 0) {
      return this.results.shift()
    } else {
      return null
    }
  }
}

