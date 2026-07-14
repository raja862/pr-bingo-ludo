import { useState, useCallback, useEffect, useRef } from 'react'

export function useChat(getChannel, mySlot, myName, roomCode) {
  const [messages, setMessages] = useState([])
  const listenerAdded = useRef(false)

  useEffect(() => {
    const channel = getChannel?.()
    if (!channel || listenerAdded.current) return

    channel.on('broadcast', { event: 'chat' }, (payload) => {
      const msg = payload.payload
      if (msg) {
        setMessages((prev) => [...prev.slice(-49), msg])
      }
    })

    listenerAdded.current = true

    return () => {
      listenerAdded.current = false
    }
  }, [getChannel, roomCode])

  const sendMessage = useCallback((text) => {
    const channel = getChannel?.()
    if (!channel || !text.trim()) return

    const msg = {
      slot: mySlot,
      name: myName || `Player ${mySlot}`,
      text: text.trim(),
      ts: Date.now(),
    }

    // Broadcast doesn't echo to sender, so append locally
    setMessages((prev) => [...prev.slice(-49), msg])

    channel.send({
      type: 'broadcast',
      event: 'chat',
      payload: msg,
    })
  }, [getChannel, mySlot, myName])

  const clearMessages = useCallback(() => {
    setMessages([])
    listenerAdded.current = false
  }, [])

  return { messages, sendMessage, clearMessages }
}
