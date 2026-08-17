import { ApplicationError, ValidationFailedError } from '../errors'
import { assertActorCanMutate, type OrganizerActor } from '../actors'
import type { Clock } from '../ports/clock'
import type { CapturedMessageRepository } from '../ports/captured-message-repository'
import type { ContactRepository } from '../ports/contact-repository'
import type { EventRepository } from '../ports/event-repository'
import type { FormRepository } from '../ports/form-repository'
import type { OrbyReplyer, OrbyTurn } from '../ports/orby-replyer'
import type { PortalResourceRepository } from '../ports/portal-resource-repository'
import type { SupportRepository } from '../ports/support-repository'
import type { TokenGenerator, TokenHasher } from '../ports/token-ports'
import { isValidEmailAddress, normalizeEmail } from '../../domain/invariants/email'
import type { EventSlug } from '../../domain/event'
import type { SupportChat, SupportMessage, SupportSenderType } from '../../domain/support'
import {
  ORBY_NAME,
  SUPPORT_MESSAGE_MAX_LENGTH,
  SUPPORT_NOTIFY_DELAY_MS,
  isArchived,
  unreadAdminCount,
} from '../../domain/support'

export interface SupportMessageDto {
  readonly id: string
  readonly content: string
  readonly senderType: SupportSenderType
  readonly senderName: string
  readonly readAt: string | null
  readonly createdAt: string
}

export interface SupportChatDto {
  readonly id: string
  readonly messages: readonly SupportMessageDto[]
  readonly unreadCount: number
  readonly userName: string
  readonly userEmail: string
}

export interface SupportChatListItemDto {
  readonly id: string
  readonly userId: string
  readonly userEmail: string
  readonly userName: string
  readonly lastMessageAt: string | null
  readonly lastMessagePreview: string | null
  readonly lastMessageSender: SupportSenderType | null
  readonly messageCount: number
  readonly unread: boolean
  readonly archived: boolean
}

export interface AdminSupportChatDto {
  readonly id: string
  readonly userId: string
  readonly userEmail: string
  readonly userName: string
  readonly archived: boolean
  readonly messages: readonly SupportMessageDto[]
}

export type SupportIdentityRole = 'guest' | 'submitter' | 'organizer' | 'none'

export interface SupportSessionDto {
  readonly role: SupportIdentityRole
  readonly needsIdentity: boolean
  readonly chat: SupportChatDto | null
  readonly guestToken: string | null
}

function preview(content: string, limit = 100): string {
  const trimmed = content.trim()
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit - 1)}…`
}

function notifyAfter(now: string): string {
  return new Date(Date.parse(now) + SUPPORT_NOTIFY_DELAY_MS).toISOString()
}

function toUserMessageDto(message: SupportMessage, userName: string): SupportMessageDto {
  return {
    id: message.id,
    content: message.content,
    senderType: message.senderType,
    senderName: message.senderType === 'admin' ? ORBY_NAME : userName,
    readAt: message.readAt,
    createdAt: message.createdAt,
  }
}

export class SupportService {
  readonly #events: EventRepository
  readonly #contacts: ContactRepository
  readonly #forms: FormRepository
  readonly #portalResources: PortalResourceRepository
  readonly #support: SupportRepository
  readonly #captured: CapturedMessageRepository
  readonly #hasher: TokenHasher
  readonly #tokens: TokenGenerator
  readonly #clock: Clock
  readonly #orby: OrbyReplyer

  constructor(
    events: EventRepository,
    contacts: ContactRepository,
    forms: FormRepository,
    portalResources: PortalResourceRepository,
    support: SupportRepository,
    captured: CapturedMessageRepository,
    hasher: TokenHasher,
    tokens: TokenGenerator,
    clock: Clock,
    orby: OrbyReplyer,
  ) {
    this.#events = events
    this.#contacts = contacts
    this.#forms = forms
    this.#portalResources = portalResources
    this.#support = support
    this.#captured = captured
    this.#hasher = hasher
    this.#tokens = tokens
    this.#clock = clock
    this.#orby = orby
  }

  async drainDueNotifications(): Promise<void> {
    const now = this.#clock.now()
    const due = await this.#support.listDueNotifications(now)
    if (due.length === 0) return
    const sent: string[] = []
    for (const item of due) {
      await this.#captured.save({
        id: crypto.randomUUID(),
        eventId: item.chat.eventId,
        toEmail: item.contactEmail,
        subject: `New reply from ${ORBY_NAME}`,
        body: `${ORBY_NAME} replied on ${item.eventName}.\n\n${preview(item.message.content, 200)}\n`,
        createdAt: now,
        kind: 'reminder',
        submissionId: null,
      })
      sent.push(item.message.id)
    }
    await this.#support.markNotified(sent, now)
  }

  async getSession(input: {
    readonly eventSlug: EventSlug
    readonly contactId: string | null
    readonly guestToken: string | null
    readonly organizer: boolean
  }): Promise<SupportSessionDto> {
    await this.drainDueNotifications()
    if (input.organizer) {
      return { role: 'organizer', needsIdentity: false, chat: null, guestToken: null }
    }
    const chat = await this.#resolveChat(input.eventSlug, input.contactId, input.guestToken)
    if (chat === null) {
      return { role: 'none', needsIdentity: true, chat: null, guestToken: null }
    }
    return {
      role: input.contactId !== null ? 'submitter' : 'guest',
      needsIdentity: false,
      chat: await this.#toChatDto(chat),
      guestToken: null,
    }
  }

  async identify(input: {
    readonly eventSlug: EventSlug
    readonly name: string
    readonly email: string
    readonly contactId: string | null
  }): Promise<SupportSessionDto> {
    const event = await this.#events.findBySlug(input.eventSlug)
    if (event === null)
      throw new ApplicationError('not_found', `Event '${input.eventSlug}' not found`)
    const name = input.name.trim()
    if (name.length === 0) throw new ValidationFailedError('Name is required', [])
    const email = normalizeEmail(input.email)
    if (!isValidEmailAddress(email)) throw new ValidationFailedError('Email is invalid', [])
    const now = this.#clock.now()
    const contact =
      input.contactId !== null
        ? await this.#contacts.findById(input.contactId)
        : await this.#contacts.ensureByEmail({
            id: crypto.randomUUID(),
            email,
            name,
            createdAt: now,
          })
    if (contact === null) throw new ApplicationError('unauthorized', 'Unknown contact')
    let chat = await this.#support.findChatByEventAndContact(event.id, contact.id)
    let guestToken: string | null = null
    if (chat === null) {
      const token = await this.#tokens.generate()
      const hash = await this.#hasher.hash(token)
      chat = {
        id: crypto.randomUUID(),
        eventId: event.id,
        contactId: contact.id,
        lastMessageAt: null,
        adminViewedAt: null,
        archivedAt: null,
        guestTokenHash: input.contactId === null ? hash : null,
        createdAt: now,
        updatedAt: now,
      }
      await this.#support.insertChat(chat)
      if (input.contactId === null) guestToken = token
    } else if (input.contactId === null) {
      const token = await this.#tokens.generate()
      const hash = await this.#hasher.hash(token)
      await this.#support.setGuestTokenHash(chat.id, hash, now)
      guestToken = token
    }
    return {
      role: input.contactId !== null ? 'submitter' : 'guest',
      needsIdentity: false,
      chat: await this.#toChatDto(chat),
      guestToken,
    }
  }

  async sendUserMessage(input: {
    readonly eventSlug: EventSlug
    readonly contactId: string | null
    readonly guestToken: string | null
    readonly content: string
    readonly pagePath: string
  }): Promise<SupportMessageDto> {
    const chat = await this.#requireOwnChat(input)
    const userMessage = await this.#append(chat, 'user', input.content, null)
    const { eventName, publicContext } = await this.#publicEventContext(input.eventSlug)
    const history = await this.#support.listMessages(chat.id)
    const reply = await this.#orby.reply({
      eventName,
      publicContext,
      pagePath: input.pagePath,
      history: history.map((message) => ({
        role: message.senderType === 'admin' ? 'assistant' : 'user',
        content: message.content,
      })),
    })
    if (reply !== null) {
      await this.#append(chat, 'admin', reply, notifyAfter(this.#clock.now()))
    }
    return userMessage
  }

  async answerOrganizer(input: {
    readonly actor: OrganizerActor
    readonly eventSlug: EventSlug
    readonly pagePath: string
    readonly content: string
    readonly history: readonly OrbyTurn[]
  }): Promise<string> {
    void input.actor
    const content = input.content.trim()
    if (content.length === 0 || content.length > SUPPORT_MESSAGE_MAX_LENGTH) {
      throw new ValidationFailedError('Message is required', [])
    }
    const { eventName, publicContext } = await this.#publicEventContext(input.eventSlug)
    const reply = await this.#orby.reply({
      eventName,
      publicContext,
      pagePath: input.pagePath,
      history: [...input.history, { role: 'user', content }],
    })
    if (reply === null) throw new ApplicationError('internal', 'Orby is unavailable')
    return reply
  }

  async #publicEventContext(
    eventSlug: EventSlug,
  ): Promise<{ readonly eventName: string; readonly publicContext: string }> {
    const event = await this.#events.findBySlug(eventSlug)
    if (event === null) throw new ApplicationError('not_found', 'Event not found')
    const [forms, resources] = await Promise.all([
      this.#forms.listByEvent(event.id),
      this.#portalResources.listByEvent(event.id),
    ])
    const now = Date.parse(this.#clock.now())
    const cfpOpen = forms.some((form) => {
      if (form.purpose !== 'public' || form.status !== 'published') return false
      const opens = form.limits.opensAt === null ? null : Date.parse(form.limits.opensAt)
      const closes = form.limits.closesAt === null ? null : Date.parse(form.limits.closesAt)
      return (opens === null || opens <= now) && (closes === null || now <= closes)
    })
    return {
      eventName: event.name,
      publicContext: [
        `status=${event.status}`,
        `timezone=${event.timezone}`,
        event.dates === null
          ? 'dates=not published'
          : `starts=${event.dates.startsAt}; ends=${event.dates.endsAt}`,
        event.venue ? `venue=${event.venue}` : 'venue=not published',
        `CFP=${cfpOpen ? 'open' : 'closed or unavailable'}`,
        `speaker resources=${
          resources
            .filter((resource) => resource.published)
            .map((resource) => resource.title)
            .join(', ') || 'none published'
        }`,
      ].join('; '),
    }
  }

  async markRead(input: {
    readonly eventSlug: EventSlug
    readonly contactId: string | null
    readonly guestToken: string | null
  }): Promise<SupportChatDto> {
    const chat = await this.#requireOwnChat(input)
    const now = this.#clock.now()
    await this.#support.markAdminMessagesRead(chat.id, now)
    const latest = await this.#support.findChatById(chat.id)
    if (latest === null) throw new ApplicationError('not_found', 'Chat not found')
    return this.#toChatDto(latest)
  }

  async listChats(
    actor: OrganizerActor,
    slug: EventSlug,
    archived: boolean,
  ): Promise<readonly SupportChatListItemDto[]> {
    void actor
    await this.drainDueNotifications()
    const event = await this.#events.findBySlug(slug)
    if (event === null) throw new ApplicationError('not_found', `Event '${slug}' not found`)
    const rows = await this.#support.listChatsByEvent(event.id, archived)
    return rows.map((row) => ({
      id: row.chat.id,
      userId: row.chat.contactId,
      userEmail: row.contactEmail,
      userName: row.contactName,
      lastMessageAt: row.chat.lastMessageAt,
      lastMessagePreview: row.lastMessagePreview === null ? null : preview(row.lastMessagePreview),
      lastMessageSender: row.lastMessageSender,
      messageCount: row.messageCount,
      unread: row.unreadForAdmin,
      archived: isArchived(row.chat),
    }))
  }

  async getAdminChat(
    actor: OrganizerActor,
    slug: EventSlug,
    chatId: string,
  ): Promise<AdminSupportChatDto> {
    void actor
    await this.drainDueNotifications()
    const event = await this.#events.findBySlug(slug)
    if (event === null) throw new ApplicationError('not_found', `Event '${slug}' not found`)
    const chat = await this.#support.findChatById(chatId)
    if (chat === null || chat.eventId !== event.id) {
      throw new ApplicationError('not_found', 'Chat not found')
    }
    const now = this.#clock.now()
    await this.#support.setAdminViewedAt(chat.id, now, now)
    const contact = await this.#contacts.findById(chat.contactId)
    if (contact === null) throw new ApplicationError('not_found', 'Chat not found')
    const messages = await this.#support.listMessages(chat.id)
    return {
      id: chat.id,
      userId: contact.id,
      userEmail: contact.email,
      userName: contact.name,
      archived: isArchived(chat),
      messages: messages.map((message) => toUserMessageDto(message, contact.name)),
    }
  }

  async sendAdminMessage(
    actor: OrganizerActor,
    slug: EventSlug,
    chatId: string,
    content: string,
  ): Promise<SupportMessageDto> {
    assertActorCanMutate(actor)
    const event = await this.#events.findBySlug(slug)
    if (event === null) throw new ApplicationError('not_found', `Event '${slug}' not found`)
    const chat = await this.#support.findChatById(chatId)
    if (chat === null || chat.eventId !== event.id) {
      throw new ApplicationError('not_found', 'Chat not found')
    }
    const now = this.#clock.now()
    return this.#append(chat, 'admin', content, notifyAfter(now))
  }

  async setArchived(
    actor: OrganizerActor,
    slug: EventSlug,
    chatId: string,
    archived: boolean,
  ): Promise<AdminSupportChatDto> {
    assertActorCanMutate(actor)
    const event = await this.#events.findBySlug(slug)
    if (event === null) throw new ApplicationError('not_found', `Event '${slug}' not found`)
    const chat = await this.#support.findChatById(chatId)
    if (chat === null || chat.eventId !== event.id) {
      throw new ApplicationError('not_found', 'Chat not found')
    }
    const now = this.#clock.now()
    await this.#support.setArchivedAt(chat.id, archived ? now : null, now)
    return this.getAdminChat(actor, slug, chatId)
  }

  async #resolveChat(
    eventSlug: EventSlug,
    contactId: string | null,
    guestToken: string | null,
  ): Promise<SupportChat | null> {
    const event = await this.#events.findBySlug(eventSlug)
    if (event === null) throw new ApplicationError('not_found', `Event '${eventSlug}' not found`)
    if (contactId !== null) {
      return this.#support.findChatByEventAndContact(event.id, contactId)
    }
    if (guestToken !== null && guestToken.length > 0) {
      const hash = await this.#hasher.hash(guestToken)
      const chat = await this.#support.findChatByGuestTokenHash(hash)
      if (chat !== null && chat.eventId === event.id) return chat
    }
    return null
  }

  async #requireOwnChat(input: {
    readonly eventSlug: EventSlug
    readonly contactId: string | null
    readonly guestToken: string | null
  }): Promise<SupportChat> {
    const chat = await this.#resolveChat(input.eventSlug, input.contactId, input.guestToken)
    if (chat === null) throw new ApplicationError('unauthorized', 'No support chat')
    return chat
  }

  async #append(
    chat: SupportChat,
    senderType: SupportSenderType,
    raw: string,
    notify: string | null,
  ): Promise<SupportMessageDto> {
    const content = raw.trim()
    if (content.length === 0) throw new ValidationFailedError('Message is required', [])
    if (content.length > SUPPORT_MESSAGE_MAX_LENGTH) {
      throw new ValidationFailedError('Message is too long', [])
    }
    const now = this.#clock.now()
    const message: SupportMessage = {
      id: crypto.randomUUID(),
      chatId: chat.id,
      content,
      senderType,
      readAt: null,
      notifyAfter: notify,
      notifiedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    await this.#support.insertMessageAndTouchChat({
      message,
      lastMessageAt: now,
      unarchive: senderType === 'user' && isArchived(chat),
    })
    const contact = await this.#contacts.findById(chat.contactId)
    return toUserMessageDto(message, contact?.name ?? 'You')
  }

  async #toChatDto(chat: SupportChat): Promise<SupportChatDto> {
    const contact = await this.#contacts.findById(chat.contactId)
    const name = contact?.name ?? 'You'
    const messages = await this.#support.listMessages(chat.id)
    return {
      id: chat.id,
      messages: messages.map((message) => toUserMessageDto(message, name)),
      unreadCount: unreadAdminCount(messages),
      userName: name,
      userEmail: contact?.email ?? '',
    }
  }
}
