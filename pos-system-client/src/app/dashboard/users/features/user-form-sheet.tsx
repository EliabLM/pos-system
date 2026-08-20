import React, { useEffect, useState } from 'react';
import { yupResolver } from '@hookform/resolvers/yup';
import type { Resolver } from 'react-hook-form';
import * as yup from 'yup';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
} from '@/components/ui/sheet';
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  Form,
} from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  IconUser,
  IconMail,
  IconLock,
  IconShield,
  IconBuildingStore,
  IconInfoCircle,
  IconAlertTriangle,
} from '@tabler/icons-react';

import { useCreateUser, useUpdateUser } from '@/hooks/useUsers';
import { useActiveStores } from '@/hooks/useStores';
import type { UserWithTenancy } from '@/actions/user/user.actions';

const createSchema = yup.object().shape({
  name: yup
    .string()
    .min(3, 'Debe ingresar mínimo 3 caracteres')
    .required('El nombre es requerido'),
  email: yup
    .string()
    .email('Debe ingresar un email válido')
    .required('El email es requerido'),
  password: yup
    .string()
    .min(8, 'La contraseña debe tener al menos 8 caracteres')
    .matches(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])/,
      'Debe contener mayúscula, minúscula, número y carácter especial'
    )
    .required('La contraseña es requerida'),
  storeId: yup.string().nullable().notRequired().defined(),
  active: yup.bool().default(true),
});

const editSchema = yup.object().shape({
  name: yup
    .string()
    .min(3, 'Debe ingresar mínimo 3 caracteres')
    .required('El nombre es requerido'),
  email: yup
    .string()
    .email('Debe ingresar un email válido')
    .required('El email es requerido'),
  storeId: yup.string().nullable().notRequired().defined(),
  active: yup.bool().default(true),
});

type CreateUserFormData = yup.InferType<typeof createSchema>;
type EditUserFormData = yup.InferType<typeof editSchema>;
type UserFormData = CreateUserFormData | EditUserFormData;

interface UserFormSheetProps {
  setSheetOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setItemSelected: React.Dispatch<React.SetStateAction<UserWithTenancy | null>>;
  itemSelected: UserWithTenancy | null;
}

export default function UserFormSheet({
  setSheetOpen,
  itemSelected,
  setItemSelected,
}: UserFormSheetProps) {
  const createMutation = useCreateUser();
  const updateMutation = useUpdateUser();
  const { data: activeStores } = useActiveStores();

  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<CreateUserFormData | EditUserFormData>({
    criteriaMode: 'firstError',
    defaultValues: itemSelected
      ? {
          name: itemSelected.name,
          email: itemSelected.email,
          storeId: itemSelected.storeId ?? null,
          active: itemSelected.isActive,
        }
      : {
          name: '',
          email: '',
          password: '',
          storeId: null,
          active: true,
        },
    mode: 'all',
    reValidateMode: 'onChange',
    resolver: yupResolver(itemSelected ? editSchema : createSchema) as Resolver<UserFormData>,
  });

  const onSubmit = async (data: UserFormData) => {
    try {
      setIsLoading(true);

      if (itemSelected) {
        // Update existing user (role/store se aplican al membership)
        await updateMutation.mutateAsync({
          userId: itemSelected.id,
          updateData: {
            name: data.name,
            storeId: data.storeId,
            isActive: data.active,
          },
        });

        toast.success('Usuario actualizado exitosamente');
      } else {
        // Create new user (identidad + membership SELLER)
        const createData = data as CreateUserFormData;
        await createMutation.mutateAsync({
          name: createData.name,
          email: createData.email,
          password: createData.password,
          role: 'SELLER', // Always SELLER
          storeId: createData.storeId,
          isActive: createData.active,
        });

        toast.success('Usuario creado exitosamente');
      }

      form.reset();
      setSheetOpen(false);
      setItemSelected(null);
    } catch (error) {
      console.error('🚀 ~ onSubmit ~ error:', error);
      if (error instanceof Error) {
        toast.error(error.message);
      } else {
        toast.error('Ha ocurrido un error guardando el usuario');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (itemSelected) {
      form.setValue('name', itemSelected.name);
      form.setValue('email', itemSelected.email);
      form.setValue('storeId', itemSelected.storeId ?? null);
      form.setValue('active', itemSelected.isActive);
    }
  }, [itemSelected, form]);

  return (
    <SheetContent className="sm:max-w-xl overflow-y-scroll">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <IconUser className="size-5" />
              {itemSelected ? 'Editar usuario' : 'Crear nuevo usuario'}
            </SheetTitle>
            <SheetDescription>
              {itemSelected
                ? 'Actualiza la información del usuario seleccionado'
                : 'Completa el formulario para crear un nuevo usuario en el sistema'}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-6 px-4 py-6">
            {/* SECTION 1: Personal Information */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  <IconUser className="h-5 w-5" />
                  Información Personal
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nombre *</FormLabel>
                      <FormControl>
                        <Input placeholder="Juan Pérez" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* SECTION 2: Authentication */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  <IconLock className="h-5 w-5" />
                  Credenciales de Acceso
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email *</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <IconMail
                            className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
                            aria-hidden="true"
                          />
                          <Input
                            type="email"
                            placeholder="usuario@ejemplo.com"
                            {...field}
                            disabled={!!itemSelected}
                            className="pl-10"
                          />
                        </div>
                      </FormControl>
                      {itemSelected && (
                        <p className="text-xs text-muted-foreground">
                          El email no se puede editar en usuarios existentes
                        </p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {!itemSelected && (
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contraseña *</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <IconLock
                              className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
                              aria-hidden="true"
                            />
                            <Input
                              type="password"
                              placeholder="••••••••"
                              {...field}
                              className="pl-10"
                            />
                          </div>
                        </FormControl>
                        <p className="text-xs text-muted-foreground">
                          Mínimo 8 caracteres, debe incluir mayúscula, minúscula,
                          número y carácter especial
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </CardContent>
            </Card>

            {/* SECTION 3: Role & Permissions */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  <IconShield className="h-5 w-5" />
                  Rol y Permisos
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormItem>
                  <FormLabel>Rol del Usuario</FormLabel>
                  <FormControl>
                    <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
                      <IconUser className="size-5 text-muted-foreground" />
                      <div className="flex-1">
                        <p className="font-medium">Vendedor</p>
                        <p className="text-xs text-muted-foreground">
                          Acceso limitado a operaciones de venta
                        </p>
                      </div>
                    </div>
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    Los nuevos usuarios siempre se crean como Vendedores
                  </p>
                </FormItem>

                <Separator />

                <FormField
                  control={form.control}
                  name="storeId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <div className="flex items-center gap-2">
                          <IconBuildingStore className="size-4" />
                          Tienda (opcional)
                        </div>
                      </FormLabel>
                      <Select
                        onValueChange={(value) => {
                          field.onChange(value === 'none' ? null : value);
                        }}
                        defaultValue={field.value ?? 'none'}
                        value={field.value ?? 'none'}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar tienda" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">Ninguna</SelectItem>
                          {activeStores?.map((store) => (
                            <SelectItem key={store.id} value={store.id}>
                              {store.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Asigna una tienda específica para este usuario
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* SECTION 4: Account Status */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  <IconInfoCircle className="h-5 w-5" />
                  Estado de la Cuenta
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="active"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Usuario Activo</FormLabel>
                        <div className="text-sm text-muted-foreground">
                          {field.value
                            ? 'El usuario puede acceder al sistema'
                            : 'El usuario no podrá iniciar sesión'}
                        </div>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {!form.watch('active') && (
                  <Alert>
                    <IconAlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      Los usuarios inactivos no podrán iniciar sesión en el
                      sistema hasta que se reactive su cuenta.
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          </div>

          <SheetFooter className="mt-6">
            <div className="flex gap-4 flex-row-reverse w-full">
              <Button type="submit" disabled={isLoading} className="flex-1 sm:flex-initial">
                {isLoading
                  ? 'Guardando...'
                  : itemSelected
                  ? 'Actualizar usuario'
                  : 'Crear usuario'}
              </Button>
              <SheetClose asChild>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isLoading}
                  onClick={() => setItemSelected(null)}
                  className="flex-1 sm:flex-initial"
                >
                  Cancelar
                </Button>
              </SheetClose>
            </div>
          </SheetFooter>
        </form>
      </Form>
    </SheetContent>
  );
}
