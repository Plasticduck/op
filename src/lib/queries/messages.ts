import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type T = Database['public']['Tables']
export type Conversation = T['conversations']['Row']
export type ConversationMember = T['conversation_members']['Row']
export type Message = T['messages']['Row']

// All conversations I'm a member of, with last_message_at + member rows joined.
// The Supabase nested-select returns members as an array; we also pull the
// locations row for site chats so the UI can render a location name.
export const conversations = {
  mine: () =>
    supabase
      .from('conversations')
      .select(
        '*, location:locations(id, name), members:conversation_members(user_id, last_read_at)',
      )
      .order('last_message_at', { ascending: false, nullsFirst: false }),
  // Find an existing 1:1 DM between two specific users (in either order). The
  // simplest way is to enumerate DMs I'm in and check the other member.
  findDm: async (myId: string, otherId: string) => {
    const { data } = await supabase
      .from('conversations')
      .select('id, members:conversation_members(user_id)')
      .eq('kind', 'dm')
    const list = (data as Array<{ id: string; members: Array<{ user_id: string }> }>) ?? []
    for (const c of list) {
      const ids = new Set(c.members.map((m) => m.user_id))
      if (ids.size === 2 && ids.has(myId) && ids.has(otherId)) return c.id
    }
    return null
  },
  // Create a new DM and add both members.
  createDm: async (accountId: string, myId: string, otherId: string) => {
    const { data: conv, error: e1 } = await supabase
      .from('conversations')
      .insert({ account_id: accountId, kind: 'dm', created_by: myId })
      .select()
      .single()
    if (e1 || !conv) return { error: e1, data: null }
    const { error: e2 } = await supabase
      .from('conversation_members')
      .insert([
        { conversation_id: conv.id, user_id: myId },
        { conversation_id: conv.id, user_id: otherId },
      ])
    return { error: e2, data: conv }
  },
  // Create an ad-hoc named group with an initial member list (must include me).
  createGroup: async (accountId: string, myId: string, name: string, memberIds: string[]) => {
    const { data: conv, error: e1 } = await supabase
      .from('conversations')
      .insert({ account_id: accountId, kind: 'group', name, created_by: myId })
      .select()
      .single()
    if (e1 || !conv) return { error: e1, data: null }
    const ids = Array.from(new Set([myId, ...memberIds]))
    const { error: e2 } = await supabase
      .from('conversation_members')
      .insert(ids.map((u) => ({ conversation_id: conv.id, user_id: u })))
    return { error: e2, data: conv }
  },
  markRead: (conversationId: string, userId: string) =>
    supabase
      .from('conversation_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId),
}

export const messages = {
  forConversation: (id: string, limit = 200) =>
    supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true })
      .limit(limit),
  send: (conversationId: string, senderId: string, body: string, attachment?: { path: string; type: string }) =>
    supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: senderId,
        body: body || null,
        attachment_path: attachment?.path ?? null,
        attachment_type: attachment?.type ?? null,
      })
      .select()
      .single(),
  remove: (id: string) => supabase.from('messages').delete().eq('id', id),
}

// Upload an image into the message-attachments bucket. Path is namespaced by
// conversation_id so the storage RLS policy can gate read access on membership.
export const attachments = {
  upload: async (conversationId: string, file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${conversationId}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage
      .from('message-attachments')
      .upload(path, file, { contentType: file.type, upsert: false })
    if (error) return { error, path: null }
    return { error: null, path }
  },
  signedUrl: async (path: string, expiresIn = 3600) => {
    const { data, error } = await supabase.storage
      .from('message-attachments')
      .createSignedUrl(path, expiresIn)
    return { error, url: data?.signedUrl ?? null }
  },
}

// Account directory of users for the new-DM / new-group picker.
export const directory = {
  list: () =>
    supabase
      .from('users')
      .select('id, name, email, role, avatar_url')
      .order('name'),
}
