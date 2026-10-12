import { FastifyInstance } from 'fastify';
import { WebSocketService } from '../../services/WebSocketService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { userService } from '../../services/UserService';

export async function websocketRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  WebSocketService.startPingInterval();

  fastify.get('/', { websocket: true, preHandler: [requireScope('read')] }, (socket, request) => {
    const userInfo = request.user
      ? { userId: request.user.userId, username: request.user.username, role: request.user.role }
      : undefined;

    // registered at once (a message sent straight after connecting must not be lost); the full name
    // follows — who is viewing shows names, not usernames (new sign-ups get made-up ones like jane_3fa9c1)
    WebSocketService.addClient(socket, userInfo);
    if (request.user) {
      const userId = request.user.userId;
      userService.displayNames([userId])
        .then((names) => { const name = names.get(userId); if (name) WebSocketService.setClientName(socket, name); })
        .catch(() => { /* the neutral 'Team member' label stays */ });
    }

    socket.send(JSON.stringify({
      type: 'connected',
      payload: { message: 'WebSocket connected', clients: WebSocketService.getClientCount() },
    }));
  });
}
