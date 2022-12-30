import P2PT from 'p2pt'
import crypto from 'hypercore-crypto'
import { SecretStream } from '@hyperswarm/secret-stream'

import { EventEmitter } from 'events'

/**
 * Represents information about a peer (i.e. its key Buffer)
 */
class P2PTPeerInfo {
  constructor(publicKey) {
    this.publicKey = publicKey
  }
}

/**
 * Hyperswarm-like peer class that runs on P2PT.
 *
 * Will have a this.keyPair with a Noise keypair.
 *
 * Will fire a 'connection' event with a duplex stream and a peer info, when a
 * peer connects.
 *
 */
export default class P2PTSwarm extends EventEmitter {

  /**
   * Get the identifier string (sha1-hashed to make a fake info hash) at which
   * to find all peers using the application.
   */
  static get IDENTIFIER_STRING() {
    return 'spartic'
  }
  
  /**
   * Get the default tracker URLs used for findign peers
   */
  static get DEFAULT_TRACKER_URLS() {
    return [
      "wss://tracker.openwebtorrent.com",
      "wss://tracker.sloppyta.co:443/",
      "wss://tracker.novage.com.ua:443/",
      "wss://tracker.btorrent.xyz:443/",
    ]
  }

  /**
   * Make a new P2PTSwarm.
   * Options can contain a 32-byte buffer "seed"
   * for making the private key.
   *
   * Also takes a "trackers" option which is a list of WebTorrent tracker URLs
   * to use for signaling. If not specified, defaults are used.
   *
   * Also takes an "identifier" option which is a string used to find other
   * instances of the application. If not specified, a default is used.
   */
  constructor(options) {
    if (!options) {
      // Default the options to something
      options = {}
    }
    // Get or make a seed for our keypair
    let seed = options.seed
    if (!seed) {
      seed = crypto.randomBytes(32)
    }
    // And make the keypair
    this.keyPair = crypto.keyPair(seed)
    
    // Get or make a tracker list
    let trackers = options.trackers
    if (!trackers) {
      trackers = this.constructor.DEFAULT_TRACKER_URLS
    }
    
    // Get or make an app identifier string
    let identifier = options.identifier
    if (!identifier) {
      identifier = this.constructor.IDENTIFIER_STRING
    }
    
    // Make the P2PT instance used to find all app users
    this.p2pt = new P2PT(trackers, identifier)
    
    // Keep track of Noise sreams by peer
    this.streams = new Map()
    
    this.p2pt.on('peerconnect', (peer) => {
      // When a peer connects, we need to set up a Noise secret stream.
      // But to do that we need to elect an initiator. Whoever has the smaller peer ID gets to be the initiator.
      let secretStream = new SecretStream(this.p2pt._peerId < peer.id)
      this.streams.set(peer.id, secretStream)
      // We need to connect the secretStream's rawStream to the one on the other end via the p2pt send() function and 'msg' event.
      secretStream.rawStream.on('data', (data) => {
        this.p2pt.send(peer, data)
      })
    })
    
    this.p2pt.on('msg', (peer, message) => {
      this.streams.get(peer.id).rawStream.write(message)
    })
  }
}
