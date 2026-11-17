import { redirect } from 'next/navigation';
import { ActorError, getActor } from '@/lib/auth/actor';

// TODO - Se realizaron ventas después de 6 pm y en los reportes no se visualizan en la opción hoy.
// TODO - Exportar PDF no funciona en ningún reporte
// TODO - Cambiar el titulo del método de pago en el reporte de ventas por método de pago (están en ingles)
// TODO - Unificar loaders en todas las tablas de parametrización, ventas, productos, inventarios. Loaders primarios y secundarios.
// TODO - Revisar filtro de este mes en reportes de clientes y generales
// TODO - Revisar card total clientes en filtro por tiendas en segmentación de clientes

// TODO - Corregir en vista actualización de usuario el rol y permisos, esta quemado solo para vendedores
// TODO - Corregir placeholder de creación de productos dependiendo del tipo de negocio
// TODO  - Corregir número de compra, se están mezclando los números entre diferentes organizaciones
// TODO - Corregir combobox de cliente en ventas, no se visualiza el boton crear cliente

/** Destino según la sesión: con membresía → dashboard; sin ella → onboarding. */
async function landingPath(): Promise<string> {
  try {
    await getActor();
    return '/dashboard';
  } catch (error) {
    if (error instanceof ActorError && error.code === 'FORBIDDEN') return '/onboarding';
    if (error instanceof ActorError) return '/auth/login';
    throw error;
  }
}

export default async function Home() {
  redirect(await landingPath());
}
