import Hyperswarm from 'hyperswarm'

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
    
    this.on('connection', (conn, info) => {
      this.log('Connected to: ', this.constructor.keyToName(info.publicKey))
      conn.on('data', (data) => {
        this.log('<-', '(' + this.constructor.keyToName(info.publicKey) + ')', data.toString())
      })
      conn.write('Hello peer!')
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
