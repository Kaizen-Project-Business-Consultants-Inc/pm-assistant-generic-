import { FastifyInstance } from 'fastify';
import { WebSocketService } from '../../services/WebSocketService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';

export async function websocketRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  WebSocketService.startPingInterval();

  fastify.get('/', { websocket: true, preHandler: [requireScope('read')] }, (socket, request) => {
    const userInfo = request.user
      ? { userId: request.user.userId, username: request.user.username, role: request.user.role }
      : undefined;

    WebSocketService.addClient(socket, userInfo);

    socket.send(JSON.stringify({
      type: 'connected',
      payload: { message: 'WebSocket connected', clients: WebSocketService.getClientCount() },
    }));
  });
}
