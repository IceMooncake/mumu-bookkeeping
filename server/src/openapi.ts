import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// 使 Zod 支持 OpenAPI 的扩展方法 (.openapi())
extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

export function generateOpenAPI() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      version: '1.0.0',
      title: 'Mumu Bookkeeping API',
      description: 'Mumu 记账软件后端 API 接口',
    },
    servers: [{ url: '/api' }],
  });
}
