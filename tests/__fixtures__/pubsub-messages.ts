// Mock Pub/Sub webhook messages for testing

export const mockPubSubMessage = {
  message: {
    data: Buffer.from(
      JSON.stringify({
        emailAddress: 'test@gmail.com',
        historyId: '12345',
      })
    ).toString('base64'),
    messageId: 'pubsub-msg-001',
    publishTime: new Date().toISOString(),
  },
  subscription: 'projects/test-project/subscriptions/test-sub',
};

export const mockGmailMessage = {
  id: 'msg-001',
  threadId: 'thread-001',
  labelIds: ['INBOX', 'UNREAD'],
  snippet: 'New job alert from LinkedIn...',
  payload: {
    headers: [
      { name: 'From', value: 'jobs-noreply@linkedin.com' },
      { name: 'Subject', value: 'Senior Software Engineer at TechCorp' },
      { name: 'Date', value: new Date().toISOString() },
    ],
    body: {
      data: Buffer.from('<html><body>Job description...</body></html>').toString('base64'),
    },
  },
};

export const mockGmailHistory = {
  history: [
    {
      id: '12345',
      messages: [mockGmailMessage],
      messagesAdded: [
        {
          message: mockGmailMessage,
        },
      ],
    },
  ],
  historyId: '12346',
};
