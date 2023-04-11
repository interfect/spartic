import P2PT from 'p2pt'
import crypto from 'hypercore-crypto'
import SecretStream from '@hyperswarm/secret-stream';

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
 * Has a joinPeer method which attempts to find and connect to the peer with
 * the given public key, and a joinTopic method which attempts to connect to
 * all peers also interested in the topic.
 *
 * Has a flush() method that returns a Promise that resolves when all joinPeer
 * peers are found. 
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
      //"wss://tracker.sloppyta.co:443/",
      //"wss://tracker.novage.com.ua:443/",
      //"wss://tracker.btorrent.xyz:443/",
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
    // And make the keypair
    this.keyPair = crypto.keyPair(seed)
    
    // Get or make a tracker list
    this.trackers = options.trackers
    if (!this.trackers) {
      this.trackers = this.constructor.DEFAULT_TRACKER_URLS
    }
    
    // Get or make an app identifier string
    this.identifier = options.identifier
    if (!this.identifier) {
      this.identifier = this.constructor.IDENTIFIER_STRING
    }
    
    // Keep track of Noise sreams by peer ID
    this.streams = new Map()
    
    // Keep track of pending peer keys
    this.pendingPeers = new Set()
    
    // Keep track of fully connected, handshook peer keys.
    this.connectedPeers = new Set()
    
    // And the callbacks waiting on the pending peers to all connect
    this.pendingPeerWaiters = []
    
    // And keep track of P2PT swarm instances by topic
    this.swarms = new Map()
    
    // And a listening flag, which we set to true if listen has been called and
    // new p2pt objects should listen immediately.
    this.listening = false
  }
  
  /**
   * Create a P2PT session on the given topic through which we can connect to peers.
   */
  addP2PT(topic) {
    this.log('P2PT adding swarm for topic', topic)
  
    // Make a P2PT instance used to find the other members of the session using the topic
    let p2pt = new P2PT(this.trackers, this.identifier + ':' + topic)
    
    p2pt.on('peerconnect', (peer) => {
      this.log('P2PT: Peer ' + p2pt._peerId + ' connected to peer ' + peer.id)
      if (this.streams.has(peer)) {
        // If we already have an entry in streams, we don't need another one.
        return;
      }
    
      // When a new peer connects, we need to set up a Noise secret stream.
      // But to do that we need to elect an initiator. Whoever has the smaller peer ID gets to be the initiator.
      let secretStream = new SecretStream(p2pt._peerId < peer.id, null, {keyPair: this.keyPair})
      this.streams.set(peer.id, secretStream)
      // We need to connect the secretStream's rawStream to the one on the other end via the p2pt send() function and 'msg' event.
      secretStream.rawStream.on('data', (data) => {
        this.p2pt.send(peer, data)
      })
      
      // We need to clean up the stream if it closes.
      secretStream.on('close', () => {
        this.streams.remove(peer.id)
      })
      
      secretStream.on('connect', () => {
        // The handshake is complete and we know the remote public key.
        let peerKey = secretStream.remotePublicKey
        
        // This peer is now fully connected.
        this.connectedPeers.add(peerKey)
        
        secretStream.on('close', () => {
          // This peer will no longer be fully connected if the stream closes
          this.connectedPeers.delete(peerKey)
        })
        
        let peerInfo = new P2PTPeerInfo(peerKey)
        // Say we have connected
        this.emit('connection', secretStream, peerInfo)
        
        if (this.pendingPeers.has(peerKey)) {
          // We were waiting for this peer.
          this.pendingPeers.delete(peerKey)
        }
        if (this.pendingPeers.size == 0) {
          for (let waiter of this.pendingPeerWaiters) {
            // Tell everyone that no peers are pending anymore.
            waiter()
          }
        }
      })
    })
    
    p2pt.on('msg', (peer, message) => {
      // When a message comes in, send it to the encryption layer.
      this.streams.get(peer.id).rawStream.write(message)
    })
    
    this.swarms.set(topic, p2pt)
    
    if (this.listening) {
      p2pt.start()
    }
  }
  
  /**
   * Start listening for connections. Returns a Promise that resolves when we
   * are ready for connections.
   */
  listen() {
    this.log('P2PT listening for connections')
    this.listening = true
    return new Promise((resolve, reject) => {
      try {
        for (let [topic, p2pt] of this.swarms) {
          // Start all the existing P2PTs
          p2pt.start()
        }
      } catch (e) {
        reject(e)
      }
      resolve()
    })
  }
  
  /**
   * Try to connect directly to the given peer, by pubkey.
   */
  joinPeer(peerKey) {
    if (!this.connectedPeers.has(peerKey)) {
      // Note that we need to wait for this peer
      this.log('P2PT waiting for peer with key ', peerKey)
      this.pendingPeers.add(peerKey)
    }
  }
  
  /**
   * Try to connect to all other peers interested in the given topic.
   */
  joinTopic(topicString) {
    this.addP2PT(topicString)
  }
  
  /**
   * Return a Promise that resolves when all joinPeer peers are found.
   */
  flush() {
    return new Promise((resolve, reject) => {
      if (this.pendingPeers.size == 0) {
        // Already done
        resolve()
      } else {
        // We need to wait for a peer in the list to connect.
        this.pendingPeerWaiters.push(resolve)
      }
    })
  }
  
  /// Log a message to the console, noting it came from this peer
  log(...args) {
    console.log('(P2PTSwarm)', ...args)
  }
}
