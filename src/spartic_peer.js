import Protomux from 'protomux'
import cenc from 'compact-encoding'
import ostruct from 'objectstruct'

import SparticSession from './spartic_session.js'
import P2PTSwarm from './p2pt_swarm.js'

/// Message which carries a shared key to one peer in a group.
/// Needs to be for a particular group.
const KeyMessageEncoding = ostruct({
  /// What group does this message belong to?
  groupId: 'integer',
  /// What shared key is the sender assigning?
  sharedKey: 'bytes'
})

/// Message which carries a broadcast block of data to peers in a group.
/// Needs to belong to a particular group.
const BlockMessageEncoding = ostruct({
  /// What group does this message belong to?
  groupId: 'string',
  /// What sequence number in the group is this block of data for?
  sequenceNumber: 'integer',
  /// What is the actual data block?
  block: 'bytes'
})

/**
 * Main peer class.
 *
 * Takes care of sending and receiving messages, and routing received messages
 * to the appropriate SparticSession state machines.
 */
export default class SparticPeer extends P2PTSwarm {
  /// How long are crypto key seeds?
  static get SEED_SIZE() {
    return 32
  }

  /// Turn a buffer into a hex string
  static keyToString(key) {
    return key.toString("hex")
  }

  /// Turn a buffer into a short hex string
  static keyToName(key) {
    return key.slice(0, 4).toString("hex")
  }


  /// Make a new SparticPeer.
  /// Takes options defined for the vase "swarm" class, such as a 32-byte buffer "seed"
  /// for making the private key.
  constructor(options) {
    super(options)
    this.log('My public key is ', this.keyPair.publicKey)

    // We need a table to map from connected peer pubkey to fancy struct, and
    // so we can drop them when the peer goes away.
    // TODO: Do we really have 1 connection per pubkey? 
    this._messengers = new Map()

    // We also have a collection of sessions for rings we are in, to keep their state.
    // Maps from group ID to SparticSession
    this._sessions = new Map()

    this.on('connection', (conn, info) => {
      this.log('Connected to: ', this.constructor.keyToName(info.publicKey))
      
      if (this._messengers.has(info.publicKey)) {
        this.log('Duplicate connection with (' + this.constructor.keyToName(info.publicKey) + ')')
        throw new Error('Duplicate connection!')
      }
      
      conn.on('data', (data) => {
        this.log('<-', '(' + this.constructor.keyToName(info.publicKey) + ')', 'Got ' + data.length + ' bytes')
      })
      
      // Connections are already message-oriented, length-prefixed streams of entire buffers. 
      // We need a real protocol over this though, since among other things we might need to be in multiple simultaneous groups with the same peer.
      // So define a protocol with Protomux
      let mux = new Protomux(conn)
      let channel = mux.createChannel({
        userData: this,
        protocol: 'spartic',
        onopen: () => {
          // The channel is open.
          // Could have a handshake argument
          this.log('Opened Spartic channel with (' + this.constructor.keyToName(info.publicKey) + ')')
        },
        onclose: () => {
          // The channel is closed.
          this.log('Closed Spartic channel with (' + this.constructor.keyToName(info.publicKey) + ')')
        }
      })
      let textMessage = channel.addMessage({
        encoding: cenc.utf8,
        onmessage: async (message) => {
          // A message has arrived
          this.log('<-', '(' + this.constructor.keyToName(info.publicKey) + ')', 'ALERT!', message)
        }
      })
      let keyMessage = channel.addMessage({
        encoding: cenc.from(KeyMessageEncoding),
        onmessage: async (message) => {
          this.log('<-', '(' + this.constructor.keyToName(info.publicKey) + ')', message)
          let session = this.sessionFor(message.groupId, info.publicKey)
          if (session) {
            // This shared key belongs in this session so put it there
            session.receiveKey(info.publicKey, message.sharedKey)
          } else {
            textMessage.send('unexpected key')
          }
        }
      })
      let blockMessage = channel.addMessage({
        encoding: cenc.from(BlockMessageEncoding),
        onmessage: async (message) => {
          this.log('<-', '(' + this.constructor.keyToName(info.publicKey) + ')', 'Round ' + message.sequenceNumber + ', ' + message.data.length + ' byte block')
          let session = this.sessionFor(message.groupId, info.publicKey)
          if (session) {
            // This block belongs in this session so put it there
            session.receiveBlock(info.publicKey, message.sequenceNumber, message.data)
          } else {
            textMessage.send('unexpected block')
          }
        }
      })
      
      
      // Save the fancy channel thingy
      this._messengers.set(info.publicKey, {
        mux: mux,
        channel: channel,
        keyMessage: keyMessage,
        blockMessage: blockMessage,
        textMessage: textMessage
      })
      
      conn.on('close', () => {
        // When the connection closes, remove the fancy channel thingy
        this.log('Closed connection with (' + this.constructor.keyToName(info.publicKey) + ')')
        this._messengers.delete(info.publicKey)
      })
      
      // TODO: Protomux API docs say we should open the message, but really we open the channel.
      channel.open()
    })
    
  }

  /// Make a new session with the given ID for the given peer keys and start it up.
  /// Returns the session object, which can be used as an inbox/outbox thingy. 
  createSession(groupId, otherPubkeys) {
    // Make the session
    let session = new SparticSession(otherPubkeys)
    this._sessions.set(groupId, session)
    for (let pubkey of otherPubkeys) {
      // Connect to everyone
      this.joinPeer(pubkey)
    }
    return session
  }

  /// Send any pending messages in a session
  sendSessionMessages(groupId) {
    let session = this._sessions.get(groupId)
    for (let pubkey of session.otherPubkeys) {
      let messenger = this._messengers.get(pubkey)
      if (messenger) {
        // We can send any messages we have for this peer
        for (let message = session.popMessage(pubkey); message != null; message = session.popMessage(pubkey)) {
          // For each message we have for the peer
          if (message[0] == 'key') {
            // Send keys
            let packed = {groupId: groupId, sharedKey: message[1]}
            this.log('-> (' + this.constructor.keyToName(pubkey) + ')', packed)
            messenger.keyMessage.send(packed)
          } else if (message[0] == 'block') {
            // Send blocks
            messenger.blockMessage.send({groupId: groupId, sequenceNumber: message[1], block: message[2]})
          } else if (message[0] == 'error') {
            // Send back error messages as text
            messenger.textMessage.send(message[1])
          }
        }
      }
    }
  }

  /// Get the SparticSession for the given group ID, if the given peer pubkey is supposed to be in it.
  /// Otherwise return null
  sessionFor(groupId, pubkey) {
    let session = this._sessions.get(groupId)
    if (session) {
      // Session exists
      if (session.otherPubkeys.indexOf(pubkey) != -1) {
        // And this peer is in it
        return session
      } else {
        this.log('No peer (' + this.constructor.keyToName(pubkey) + ') in session ' + groupId + ': ', session)
      }
    } else {
      this.log('No session ', groupId, 'Sessions: ', this._sessions)
    }
    return null
  }

  /// Get a short name for this peer defined by its key
  getName() {
    return this.constructor.keyToName(this.keyPair.publicKey)
  }
  
  /// Log status of the peer (connections, pending messages, etc.)
  logStatus() {
    // Short names of everyone we have messages to
    let pendingTo = []
    // Short names of everyone we are connected to
    let connectedTo = []
    for (let [groupId, session] of this._sessions.entries()) {
      for (let [pubkey, queue] of session.queues.entries()) {
        if (queue.length > 0) {
          pendingTo.push('(' + this.constructor.keyToName(pubkey) + ')')
        }
      }
    }
    for (let connection of this.connections) {
      connectedTo.push('(' + this.constructor.keyToName(connection.remotePublicKey) + ')')
    }
    this.log(this.connections.size + ' connections [' + connectedTo + '], ' + this.peers.size + ' peers, pending messages to [' + pendingTo + ']')
    for (let [groupId, session] of this._sessions.entries()) {
      this.log('\tSession ' + groupId, session.getStatus())
    }
  }
  
  /// Log a message to the console, noting it came from this peer
  log(...args) {
    console.log('(' + this.getName() + ')', ...args)
  }

}
