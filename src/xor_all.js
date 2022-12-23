import buffer_xor from 'buffer-xor'

/// XOR together all the buffers in an array. Returns a new buffer, or null for
/// an empty array of buffers.
export default function xor_all(buffers) {
  if (buffers.length == 0) {
    return null
  } else if (buffers.length == 1) {
    return buffers[0]
  } else {
    let scratch = buffers[0]
    for (let i = 1; i < buffers.length; i++) {
      scratch = buffer_xor(scratch, buffers[i])
    }
    return scratch
  }
}
