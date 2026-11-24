'use server';

/**
 * Organizaciones. Registro libre (#11): quien se registra crea SU negocio en el
 * onboarding y queda como ADMIN. No hay acciones multi-organización: ver o
 * administrar otras organizaciones no es posible desde la app.
 */

import { z } from 'zod';
import { MembershipRole, MembershipStatus, Organization, PaymentMethod, Prisma } from '@/generated/prisma';
import { ActionResponse } from '@/interfaces';
import { actorErrorResponse, requireOnboardingUser } from '@/lib/auth/actor';
import { prisma } from '../utils';
import { BUSINESS_TYPE_KEY } from '../system-config/system-config.schemas';


// Definir constantes para configuraciones por defecto
const DEFAULT_PAYMENT_METHODS: Omit<
  PaymentMethod,
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'isActive'
  | 'organizationId'
  | 'isDeleted'
  | 'deletedAt'
>[] = [
  { name: 'Efectivo', type: 'CASH' },
  { name: 'Tarjeta', type: 'CARD' },
  { name: 'Cheque', type: 'CHECK' },
  { name: 'Crédito', type: 'CREDIT' },
  { name: 'Transferencia', type: 'TRANSFER' },
  { name: 'Otro', type: 'OTHER' },
] as const;

// ============================================
// CONSTANTES PARA ZAPATERÍAS
// ============================================

// Categorías para ZAPATERÍAS (Calzado deportivo)
const FOOTWEAR_CATEGORIES = [
  { name: 'Calzado Hombre', description: 'Calzado deportivo para hombre' },
  { name: 'Calzado Mujer', description: 'Calzado deportivo para mujer' },
  { name: 'Calzado Niños', description: 'Calzado deportivo para niños' },
  { name: 'Zapatillas Running', description: 'Zapatillas especializadas para correr' },
  { name: 'Zapatillas Training', description: 'Zapatillas para entrenamiento y gimnasio' },
  { name: 'Zapatillas Basketball', description: 'Zapatillas de baloncesto' },
  { name: 'Zapatillas Fútbol', description: 'Guayos y zapatillas de fútbol' },
  { name: 'Zapatillas Casual', description: 'Calzado deportivo casual/lifestyle' },
  { name: 'Zapatillas Skateboarding', description: 'Zapatillas para skateboarding' },
  { name: 'Sandalias Deportivas', description: 'Sandalias y chancletas deportivas' },
] as const;

// Marcas para ZAPATERÍAS (Internacionales - Calzado deportivo)
const FOOTWEAR_BRANDS_INTERNATIONAL = [
  { name: 'Nike', description: 'Marca estadounidense líder en calzado deportivo' },
  { name: 'Adidas', description: 'Marca alemana de calzado deportivo' },
  { name: 'Puma', description: 'Marca alemana de artículos deportivos' },
  { name: 'Reebok', description: 'Marca británica-estadounidense de calzado deportivo' },
  { name: 'New Balance', description: 'Marca estadounidense especializada en running' },
  { name: 'Asics', description: 'Marca japonesa especializada en calzado deportivo' },
  { name: 'Converse', description: 'Marca estadounidense icónica de zapatillas' },
  { name: 'Vans', description: 'Marca estadounidense de zapatillas skate' },
  { name: 'Under Armour', description: 'Marca estadounidense de ropa y calzado deportivo' },
  { name: 'Fila', description: 'Marca italiana de calzado deportivo' },
  { name: 'Skechers', description: 'Marca estadounidense de calzado lifestyle y deportivo' },
  { name: 'Jordan', description: 'Línea de Nike especializada en basketball' },
  { name: 'Mizuno', description: 'Marca japonesa especializada en calzado deportivo' },
  { name: 'Saucony', description: 'Marca estadounidense especializada en running' },
  { name: 'Brooks', description: 'Marca estadounidense especializada en running' },
  { name: 'Salomon', description: 'Marca francesa especializada en outdoor y trail' },
  { name: 'Hoka One One', description: 'Marca francesa especializada en running maximalista' },
  { name: 'On Running', description: 'Marca suiza de calzado de running premium' },
  { name: 'Crocs', description: 'Marca estadounidense de calzado cómodo' },
  { name: 'Timberland', description: 'Marca estadounidense de calzado outdoor y casual' },
] as const;

// ============================================
// CONSTANTES PARA LICORERAS
// ============================================

// Categorías para LICORERAS
const LIQUOR_CATEGORIES = [
  { name: 'Whisky', description: 'Whisky escocés, irlandés, bourbon, etc.' },
  { name: 'Ron', description: 'Ron blanco, añejo, premium' },
  { name: 'Vodka', description: 'Vodka nacional e importado' },
  { name: 'Tequila', description: 'Tequila blanco, reposado, añejo' },
  { name: 'Ginebra', description: 'Ginebra dry, London dry, premium' },
  { name: 'Aguardiente', description: 'Aguardiente nacional' },
  { name: 'Cerveza Nacional', description: 'Cervezas nacionales' },
  { name: 'Cerveza Importada', description: 'Cervezas importadas' },
  { name: 'Vino Tinto', description: 'Vinos tintos nacionales e importados' },
  { name: 'Vino Blanco', description: 'Vinos blancos nacionales e importados' },
  { name: 'Vino Rosado', description: 'Vinos rosados' },
  { name: 'Champagne/Espumosos', description: 'Champagne y vinos espumosos' },
  { name: 'Licores', description: 'Licores cremosos y digestivos' },
  { name: 'Brandy/Cognac', description: 'Brandy y cognac' },
  { name: 'Aperitivos', description: 'Aperitivos y vermut' },
] as const;

// Marcas para LICORERAS (Nacionales Colombia)
const LIQUOR_BRANDS_NATIONAL = [
  { name: 'Aguardiente Antioqueño', description: 'Aguardiente colombiano' },
  { name: 'Ron Viejo de Caldas', description: 'Ron colombiano' },
  { name: 'Club Colombia', description: 'Cerveza premium colombiana' },
  { name: 'Poker', description: 'Cerveza colombiana' },
  { name: 'Aguila', description: 'Cerveza colombiana' },
  { name: 'Pilsen', description: 'Cerveza colombiana' },
  { name: 'Tres Cordilleras', description: 'Ron colombiano' },
] as const;

// Marcas para LICORERAS (Internacionales)
const LIQUOR_BRANDS_INTERNATIONAL = [
  { name: 'Johnnie Walker', description: 'Whisky escocés' },
  { name: 'Jack Daniels', description: 'Whisky americano' },
  { name: 'Bacardi', description: 'Ron caribeño' },
  { name: 'Absolut', description: 'Vodka sueco' },
  { name: 'Smirnoff', description: 'Vodka' },
  { name: 'Jose Cuervo', description: 'Tequila mexicano' },
  { name: 'Heineken', description: 'Cerveza holandesa' },
  { name: 'Corona', description: 'Cerveza mexicana' },
  { name: 'Budweiser', description: 'Cerveza americana' },
  { name: 'Stella Artois', description: 'Cerveza belga' },
] as const;

// ============================================
// UNIDADES DE MEDIDA POR TIPO DE NEGOCIO
// ============================================

// Unidades de medida para LICORERAS
const LIQUOR_UNIT_MEASURES = [
  { name: 'Botella', abbreviation: 'bot' },
  { name: 'Lata', abbreviation: 'lata' },
  { name: 'Litro', abbreviation: 'L' },
  { name: 'Mililitro', abbreviation: 'ml' },
  { name: 'Caja', abbreviation: 'cj' },
  { name: 'Six-pack', abbreviation: '6pk' },
  { name: 'Twelve-pack', abbreviation: '12pk' },
  { name: 'Docena', abbreviation: 'doc' },
  { name: 'Barril', abbreviation: 'barril' },
] as const;

// Unidades de medida para ZAPATERÍAS
const FOOTWEAR_UNIT_MEASURES = [
  { name: 'Unidad', abbreviation: 'un' },
  { name: 'Par', abbreviation: 'par' },
  { name: 'Caja', abbreviation: 'cj' },
] as const;

const createInitialConfigurations = async (
  organizationId: string,
  businessType?: 'liquor_store' | 'shoe_store' | null
): Promise<void> => {
  try {
    // Determinar qué categorías y marcas crear según el tipo de negocio
    let categories;
    let brands;
    let unitMeasures;

    if (businessType === 'liquor_store') {
      categories = LIQUOR_CATEGORIES;
      brands = [...LIQUOR_BRANDS_NATIONAL, ...LIQUOR_BRANDS_INTERNATIONAL];
      unitMeasures = LIQUOR_UNIT_MEASURES;
    } else if (businessType === 'shoe_store') {
      categories = FOOTWEAR_CATEGORIES;
      brands = FOOTWEAR_BRANDS_INTERNATIONAL;
      unitMeasures = FOOTWEAR_UNIT_MEASURES;
    } else {
      // Sin tipo de negocio específico - usar configuración genérica
      categories = FOOTWEAR_CATEGORIES;
      brands = FOOTWEAR_BRANDS_INTERNATIONAL;
      unitMeasures = FOOTWEAR_UNIT_MEASURES;
    }

    // EJECUTAR OPERACIONES SECUENCIALMENTE POR TIPO
    // Sin transacción global para evitar conflictos con transacciones anidadas

    // Catálogo inicial y métodos de pago de la organización recién creada: se
    // escriben directo (no por las actions, que exigen el actor de sesión).
    // 1. Crear categorías
    await prisma.category.createMany({
      data: categories.map((category) => ({
        organizationId,
        name: category.name,
        description: category.description,
        isActive: true,
      })),
      skipDuplicates: true,
    });

    // 2. Crear métodos de pago
    await prisma.paymentMethod.createMany({
      data: DEFAULT_PAYMENT_METHODS.map((method) => ({
        organizationId,
        name: method.name,
        type: method.type,
        isActive: true,
      })),
      skipDuplicates: true,
    });

    // 3. Crear marcas según tipo de negocio
    await prisma.brand.createMany({
      data: brands.map((brand) => ({
        organizationId,
        name: brand.name,
        description: brand.description,
        isActive: true,
      })),
      skipDuplicates: true,
    });

    // 4. Crear unidades de medida según tipo de negocio
    await prisma.unitMeasure.createMany({
      data: unitMeasures.map((unit) => ({
        organizationId,
        name: unit.name,
        abbreviation: unit.abbreviation,
        isActive: true,
      })),
      skipDuplicates: true,
    });
  } catch (error) {
    // Re-lanzar el error para que sea manejado por el caller
    throw error;
  }
};

// CREATE (onboarding) — organización propia + membresía ADMIN del creador
const optionalText = (max: number) =>
  z.string().trim().max(max).nullish().transform((value) => (value ? value : null));

const createOrganizationSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es requerido').max(150),
  email: z.string().trim().email('Email inválido').max(254),
  nit: optionalText(30),
  phone: optionalText(30),
  address: optionalText(255),
  city: optionalText(100),
  department: optionalText(100),
  taxId: optionalText(30),
});

export type CreateOrganizationInput = z.input<typeof createOrganizationSchema>;

const businessTypeSchema = z.enum(['liquor_store', 'shoe_store']).nullish();

export const createOrganization = async (
  organizationData: CreateOrganizationInput,
  businessType?: 'liquor_store' | 'shoe_store' | null
): Promise<ActionResponse<Organization | null>> => {
  try {
    // Solo un usuario con sesión y SIN membresía activa crea su organización.
    const { userId } = await requireOnboardingUser();

    const parsed = createOrganizationSchema.safeParse(organizationData);
    const parsedType = businessTypeSchema.safeParse(businessType || null);
    if (!parsed.success || !parsedType.success) {
      return {
        status: 400,
        message: parsed.success ? 'Tipo de negocio inválido' : parsed.error.issues[0]?.message ?? 'Datos inválidos',
        data: null,
      };
    }
    const data = parsed.data;
    const type = parsedType.data ?? null;

    if (data.nit) {
      const existingOrgByNit = await prisma.organization.findFirst({
        where: { nit: data.nit, isDeleted: false },
        select: { id: true },
      });
      if (existingOrgByNit) {
        return { status: 409, message: 'Ya existe una organización con ese NIT', data: null };
      }
    }

    const newOrganization = await prisma.$transaction(async (tx) => {
      // Serializa envíos simultáneos del mismo usuario: una sola organización.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const alreadyMember = await tx.membership.findFirst({
        where: { userId, deletedAt: null, status: MembershipStatus.ACTIVE },
        select: { id: true },
      });
      if (alreadyMember) return null;

      const organization = await tx.organization.create({
        data: { ...data, isActive: true },
      });
      await tx.membership.create({
        data: {
          userId,
          organizationId: organization.id,
          role: MembershipRole.ADMIN,
          status: MembershipStatus.ACTIVE,
          acceptedAt: new Date(),
        },
      });
      if (type) {
        await tx.systemConfig.create({
          data: {
            organizationId: organization.id,
            key: BUSINESS_TYPE_KEY,
            value: type,
            type: 'STRING',
            description: 'Tipo de negocio de la organización',
          },
        });
      }
      return organization;
    });

    if (!newOrganization) {
      return { status: 409, message: 'El usuario ya pertenece a una organización', data: null };
    }


    // Configuraciones iniciales (categorías, marcas, métodos de pago...). Ya
    // existe la membresía ADMIN, así que pasan las comprobaciones de sesión.
    try {
      await createInitialConfigurations(newOrganization.id, type);
    } catch (error) {
      console.error('Error creating initial configurations for organization:', newOrganization.id, error);
      // No falla la creación: el usuario puede crearlas manualmente después.
    }

    return {
      status: 201,
      message: 'Organización creada exitosamente',
      data: newOrganization,
    };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;

    console.error('Error creating organization:', error);

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = error.meta?.target as string[] | undefined;
      if (target?.includes('nit')) {
        return { status: 409, message: 'Ya existe una organización con ese NIT', data: null };
      }
    }

    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};
