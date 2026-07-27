-- ============================================================================
-- LumenX Labs - Staging Seed Data
-- Ejecutar: npx prisma db execute --schema prisma/schema.prisma --file prisma/seed-lumenx.sql
-- ============================================================================

TRUNCATE TABLE products CASCADE;
TRUNCATE TABLE businesses CASCADE;

-- Business principal
INSERT INTO businesses (id, name, whatsapp_phone_id, whatsapp_token_encrypted, system_prompt_extras, settings_jsonb, updated_at)
VALUES (
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'LumenX Labs',
  '1161637943695191',
  'dev-token-placeholder',
  E'SOBRE LUMENX LABS:\nLumenX Labs es una empresa de desarrollo y automatización de software, diseño de páginas web premium y soluciones digitales a medida. Fundada por Christian Henao, un desarrollador con 5+ años de experiencia en múltiples campos.\n\nSERVICIOS:\n- Desarrollo de software a medida (web, móvil, APIs)\n- Automatización de procesos y flujos de trabajo\n- Diseño y desarrollo de páginas web premium\n- Integración con APIs externas (WhatsApp, pagos, CRM)\n- Chatbots e inteligencia artificial para negocios\n- Consultoría tecnológica\n\nIDIOMAS:\n- Español (principal)\n- Inglés\n\nCONTACTO:\n- Web: lumenxlabs.com.co\n- Líder: Christian Henao\n\nESTILO DE RESPUESTA:\n- Sé profesional pero cercano.\n- Habla de los servicios con confianza.\n- Si el cliente quiere un presupuesto, pide detalles del proyecto y indica que el equipo lo contactará pronto.\n- Menciona que LumenX Labs trabaja con tecnologías modernas (React, Next.js, NestJS, Python, IA).\n- Si el cliente pregunta por precios, indica que cada proyecto es personalizado y se cotiza según los requerimientos.',
  '{"language":"auto","business_hours":"Lun-Vie 9:00-18:00","location":"Colombia","website":"https://lumenxlabs.com.co"}'::jsonb,
  now()
);

-- Servicios como "productos" para el catálogo
INSERT INTO products (id, business_id, name, description, price, stock, category, active, updated_at)
VALUES
  ('p001', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Desarrollo Web Premium', 'Sitios web modernos con React, Next.js y diseños premium. Incluye responsive design, SEO y rendimiento optimizado.', 0, 999, 'Desarrollo', true, now()),
  ('p002', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Aplicaciones Móviles', 'Apps nativas e híbridas para iOS y Android con React Native o Flutter.', 0, 999, 'Desarrollo', true, now()),
  ('p003', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Automatización de Procesos', 'Automatización de flujos de trabajo con integraciones API, bots y herramientas inteligentes.', 0, 999, 'Automatización', true, now()),
  ('p004', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Chatbots con IA', 'Asistentes virtuales inteligentes para WhatsApp, web y redes sociales. Potenciados con IA generativa.', 0, 999, 'IA', true, now()),
  ('p005', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Consultoría Tecnológica', 'Asesoría personalizada para elegir la mejor stack tecnológica y estrategia digital para tu negocio.', 0, 999, 'Consultoría', true, now()),
  ('p006', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Integración WhatsApp Business API', 'Conecta tu negocio con WhatsApp Business API para atención automatizada y escalable.', 0, 999, 'Integraciones', true, now());
