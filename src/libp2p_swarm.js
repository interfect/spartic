import { createLibp2p } from 'libp2p'
import { generateKeyPairFromSeed } from '@libp2p/crypto/keys'
import { createFromPrivKey } from '@libp2p/peer-id-factory'
import { webSockets } from '@libp2p/websockets'
import { noise } from '@chainsafe/libp2p-noise'
import { mplex } from '@libp2p/mplex'

import { bootstrap } from '@libp2p/bootstrap'
import { mdns } from '@libp2p/mdns'

import { EventEmitter } from 'events'

import crypto from 'hypercore-crypto'

/**
 * Represents information about a peer (i.e. its key Buffer)
 */
class LibP2PPeerInfo {
  constructor(publicKey) {
    this.publicKey = publicKey
  }
}

/**
 * Hyperswarm-like peer class that runs on LibP2P.
 *
 * Will have a this.keyPair with a {publicKey, privateKey} keypair.
 *
 * Will fire a 'connection' event with a duplex stream and a peer info, when a
 * peer connects.
 *
 * Has a joinPeer method which attempts to find and connect to the peer with
 * the given public key, and a joinTopic method which attempts to connect to
 * all peers also interested in the topic.
 *
 * Has a flush() method that returns a Promise that resolves when all joinPeer
 * peers are found. 
 */
export default class LibP2PSwarm extends EventEmitter {

  /**
   * Get the identifier string at which to find all peers using the
   * application.
   */
  static get IDENTIFIER_STRING() {
    return 'spartic'
  }
  
  /**
   * Get the default tracker URLs used for findign peers
   */
  static get DEFAULT_BOOTSTRAP_ADDRS() {
    return [
      '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
      '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN'
    ]
  }

  /**
   * Make a new swarm.
   * Options can contain a 32-byte buffer "seed"
   * for making the private key.
   *
   * Also takes an "identifier" option which is a string used to find other
   * instances of the application. If not specified, a default is used.
   *
   * Construction is asynchronous and is not done until this.ready is resolved.
   */
  constructor(options) {
    super()
    if (!options) {
      // Default the options to something
      options = {}
    }
    // Get or make a seed for our keypair
    let seed = options.seed
    if (!seed) {
      seed = crypto.randomBytes(32)
    }
    
    // Get or make a bootstrap list
    this.bootstrap = options.bootstrap
    if (!this.bootstrap) {
      this.bootstrap = this.constructor.DEFAULT_BOOTSTRAP_ADDRS
    }
    
    // Get or make an app identifier string
    this.identifier = options.identifier
    if (!this.identifier) {
      this.identifier = this.constructor.IDENTIFIER_STRING
    }
    
    // LibP2P key generation is all async
    this.ready = (async () => {
      let privateKey = await generateKeyPairFromSeed('ed25519', seed)
      this.peerId = await createFromPrivKey(privateKey)
      this.keyPair = {privateKey: privateKey, publicKey: privateKey._publicKey}
    })()
  }
  
  /**
   * Start listening for connections. Returns a Promise that resolves when we
   * are ready for connections.
   */
  async listen() {
    await this.ready
    
    const node = await createLibp2p({
      peerId: this.peerId,
      transports: [webSockets()],
      connectionEncryption: [noise()],
      streamMuxers: [mplex()],
      peerDiscovery: [
        mdns(),
        bootstrap({
          list: this.bootstrap,
        })
      ]
    })
    
    node.addEventListener('peer:discovery', (evt) => {
      this.log('Discovered ', evt.detail.id.toString()) // Log discovered peer
    })

    node.connectionManager.addEventListener('peer:connect', (evt) => {
      this.log('Connected to ', evt.detail.remotePeer.toString()) // Log connected peer
    })
  }
  
  /**
   * Try to connect directly to the given peer, by pubkey.
   */
  joinPeer(peerKey) {
  }
  
  /**
   * Try to connect to all other peers interested in the given topic.
   */
  joinTopic(topicString) {
  }
  
  /**
   * Return a Promise that resolves when all joinPeer peers are found.
   */
  flush() {
  }
  
  /// Log a message to the console, noting it came from this peer
  log(...args) {
    console.log('(LibP2PSwarm)', ...args)
  }
}
