-- LumenX Labs catalog seed — 20 tech products
-- business_id: a1b2c3d4-e5f6-7890-abcd-ef1234567890

INSERT INTO products (id, business_id, name, description, price, stock, category, active, created_at, updated_at) VALUES
-- Laptops
('p001a001-0000-0000-0000-000000000001', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'MacBook Pro 14 M3', 'Laptop Apple con chip M3, 18GB RAM, 512GB SSD. Perfecta para desarrollo y diseño.', 1999.00, 15, 'Laptops', true, NOW(), NOW()),
('p001a001-0000-0000-0000-000000000002', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Dell XPS 15', 'Laptop Dell con Intel i7-13700H, 16GB RAM, 512GB SSD, pantalla OLED 3.5K.', 1599.00, 10, 'Laptops', true, NOW(), NOW()),
('p001a001-0000-0000-0000-000000000003', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'ThinkPad X1 Carbon', 'Laptop Lenovo ultraligera, Intel i7, 16GB RAM, 1TB SSD, ideal para ejecutivos.', 1849.00, 8, 'Laptops', true, NOW(), NOW()),
('p001a001-0000-0000-0000-000000000004', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'HP Spectre x360', 'Laptop convertible 2-en-1, Intel i7, 16GB RAM, pantalla táctil 14 pulgadas.', 1449.00, 12, 'Laptops', true, NOW(), NOW()),

-- Smartphones
('p001a001-0000-0000-0000-000000000005', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'iPhone 15 Pro', 'Smartphone Apple con chip A17 Pro, 256GB, cámara de 48MP, titanio.', 1199.00, 25, 'Smartphones', true, NOW(), NOW()),
('p001a001-0000-0000-0000-000000000006', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Samsung Galaxy S24 Ultra', 'Smartphone Samsung con S Pen, 256GB, cámara de 200MP, pantalla AMOLED 6.8".', 1299.00, 20, 'Smartphones', true, NOW(), NOW()),
('p001a001-0000-0000-0000-000000000007', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Google Pixel 8 Pro', 'Smartphone Google con chip Tensor G3, 128GB, cámara con IA, 7 años de actualizaciones.', 999.00, 18, 'Smartphones', true, NOW(), NOW()),

-- Accesorios
('p001a001-0000-0000-0000-000000000008', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'AirPods Pro 2', 'Auriculares inalámbricos Apple con cancelación de ruido activa y audio espacial.', 249.00, 40, 'Accesorios', true, NOW(), NOW()),
('p001a001-0000-0000-0000-000000000009', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Samsung Galaxy Buds2 Pro', 'Auriculares inalámbricos Samsung con ANC, sonido Hi-Fi 24bit, IPX7.', 179.00, 35, 'Accesorios', true, NOW(), NOW()),
('p001a001-0000-0000-0000-000000000010', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Logitech MX Master 3S', 'Mouse inalámbrico ergonómico con scroll magnético, silencioso, USB-C.', 99.00, 50, 'Accesorios', true, NOW(), NOW()),
('p001a001-0000-0000-0000-000000000011', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Keychron K3 Pro', 'Teclado mecánico inalámbrico slim, switches Low Profile, RGB, Bluetooth.', 119.00, 30, 'Accesorios', true, NOW(), NOW()),

-- Monitores
('p001a001-0000-0000-0000-000000000012', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'LG UltraFine 27UK850', 'Monitor 4K 27 pulgadas, HDR10, USB-C 60W, AMD FreeSync, 99% sRGB.', 549.00, 14, 'Monitores', true, NOW(), NOW()),
('p001a001-0000-0000-0000-000000000013', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Dell UltraSharp U2723QE', 'Monitor 4K 27", IPS Black, USB-C 90W Hub, VESA DisplayHDR 400.', 619.00, 10, 'Monitores', true, NOW(), NOW()),

-- Almacenamiento
('p001a001-0000-0000-0000-000000000014', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Samsung T7 Portable SSD 1TB', 'SSD portátil USB 3.2, lectura 1050MB/s, compacto y resistente.', 109.00, 45, 'Almacenamiento', true, NOW(), NOW()),
('p001a001-0000-0000-0000-000000000015', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'WD Black SN850X 2TB', 'SSD NVMe PCIe Gen4, lectura 7300MB/s, ideal para gaming y edición.', 189.00, 22, 'Almacenamiento', true, NOW(), NOW()),

-- Networking
('p001a001-0000-0000-0000-000000000016', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Ubiquiti UniFi Dream Router', 'Router WiFi 6E, Mesh, 4x4 MIMO, integración UniFi, gestión centralizada.', 349.00, 8, 'Networking', true, NOW(), NOW()),
('p001a001-0000-0000-0000-000000000017', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'TP-Link Deco XE75', 'Sistema Mesh WiFi 6E, tri-band, cobertura hasta 550m², pack de 3.', 299.00, 12, 'Networking', true, NOW(), NOW()),

-- Audio
('p001a001-0000-0000-0000-000000000018', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Sony WH-1000XM5', 'Auriculares over-keh ANC líder, 30h batería, LDAC, multipoint.', 349.00, 16, 'Audio', true, NOW(), NOW()),
('p001a001-0000-0000-0000-000000000019', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'JBL Charge 5', 'Bocina portátil resistente al agua IP67, 20h batería, powerbank.', 179.00, 28, 'Audio', true, NOW(), NOW()),

-- Cables y cargadores
('p001a001-0000-0000-0000-000000000020', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Anker Nano II 65W', 'Cargador GaN USB-C compacto, carga rápida para laptops y smartphones.', 45.00, 60, 'Cables y Cargadores', true, NOW(), NOW());
