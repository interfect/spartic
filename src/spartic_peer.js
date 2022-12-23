import Hyperswarm from 'hyperswarm'

import Protomux from 'protomux'
import cenc from 'compact-encoding'

/**
 * Main peer class.
 *
 * Takes care of receiving messages and doing the right thing with them according to the state.
 */
export default class SparticPeer extends Hyperswarm {
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
  /// Takes options defined for a Hyperswarm, such as a 32-byte buffer "seed"
  /// for making the private key.
  constructor(options) {
    super(options)
    this.log('My public key is ', this.keyPair.publicKey)

    // We need a table to map from connected peer pubkey to fancy struct, and
    // so we can drop them when the peer goes away.
    // TODO: Do we really have 1 connection per pubkey? 
    this._messengers = {}

    this.on('connection', (conn, info) => {
      this.log('Connected to: ', this.constructor.keyToName(info.publicKey))
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
          this.log('<-', '(' + this.constructor.keyToName(info.publicKey) + ')', message)
        }
      })

      // Save the fancy channel thingy
      this._messengers[info.publicKey] = {
        mux: mux,
        channel: channel,
        textMessage: textMessage
      }
      
      conn.on('close', () => {
        // When the connection closes, remove the fancy channel thingy
        delete this._messengers[info.publicKey]
      })
      
      // TODO: Protomux API docs say we should open the message, but really we open the channel.
      channel.open()
      textMessage.send('Hello peer!')
    })
    
  }

  /// Get a short name for this peer defined by its key
  getName() {
    return this.constructor.keyToName(this.keyPair.publicKey)
  }
  
  /// Log a message to the console, noting it came from this peer
  log(...args) {
    console.log('(' + this.getName() + ')', ...args)
  }

}
