import Hyperswarm from 'hyperswarm'

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

