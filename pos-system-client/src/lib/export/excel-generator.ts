/**
 * Excel Generator Utility
 *
 * Generates Excel files from data arrays using ExcelJS.
 * Client-side only - uses dynamic imports for browser compatibility.
 *
 * STRICT TYPING: Zero `any` types
 */

'use client';

import type {
  ExcelGeneratorOptions,
  ExcelSheetConfig,
} from '@/interfaces/reports';

type ExcelRow = Record<string, string | number | boolean | null>;
type ExcelJSModule = typeof import('exceljs');
type ExcelWorkbook = InstanceType<ExcelJSModule['Workbook']>;

/**
 * Load ExcelJS on demand (client-side only, keeps it out of the main bundle)
 */
async function loadExcelJS(): Promise<ExcelJSModule> {
  const mod = (await import('exceljs')) as ExcelJSModule & {
    default?: ExcelJSModule;
  };
  return mod.default ?? mod;
}

/**
 * Build the metadata rows ("Generado: <fecha>") placed before the data
 */
function buildDateRows(firstKey: string | undefined): ExcelRow[] {
  const currentDate = new Date().toLocaleDateString('es-ES', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const dateRow: ExcelRow = {};
  if (firstKey !== undefined) {
    dateRow[firstKey] = `Generado: ${currentDate}`;
  }
  return [{}, dateRow, {}];
}

/**
 * Collect column keys: explicit headers first, then any other key in order of
 * first appearance (same behaviour as SheetJS `json_to_sheet`).
 */
function collectColumns(rows: ExcelRow[], headers: string[] = []): string[] {
  const columns = [...headers];
  const seen = new Set(columns);
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    });
  });
  return columns;
}

/**
 * Add a worksheet with the given rows to the workbook
 */
function addSheet(
  workbook: ExcelWorkbook,
  sheetName: string,
  rows: ExcelRow[],
  options: { headers?: string[]; includeHeaders: boolean; widths?: number[] }
): void {
  const worksheet = workbook.addWorksheet(sheetName);
  const columns = collectColumns(rows, options.headers);

  if (options.includeHeaders) {
    worksheet.addRow(columns);
  }

  rows.forEach((row) => {
    worksheet.addRow(
      columns.map((key) => {
        const value = row[key];
        return value === undefined ? null : value;
      })
    );
  });

  options.widths?.forEach((width, index) => {
    worksheet.getColumn(index + 1).width = width;
  });
}

/**
 * Serialize the workbook and trigger the browser download
 */
async function downloadWorkbook(
  workbook: ExcelWorkbook,
  filename: string
): Promise<void> {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Generate an Excel file from an array of data
 *
 * @param data - Array of objects to export
 * @param options - Excel generation options
 * @throws Error if generation fails
 */
export async function generateExcel<T extends ExcelRow>(
  data: T[],
  options: ExcelGeneratorOptions
): Promise<void> {
  const {
    filename,
    sheetName = 'Datos',
    includeHeaders = true,
    autoWidth = true,
    includeDate = true,
  } = options;

  try {
    // Dynamic import for client-side only library
    const ExcelJS = await loadExcelJS();

    if (data.length === 0) {
      throw new Error('No hay datos para exportar');
    }

    const rows: ExcelRow[] = [
      ...(includeDate ? buildDateRows(Object.keys(data[0])[0]) : []),
      ...data,
    ];

    const workbook = new ExcelJS.Workbook();
    addSheet(workbook, sheetName, rows, {
      includeHeaders,
      widths: autoWidth ? calculateColumnWidths(data) : undefined,
    });

    await downloadWorkbook(workbook, filename);
  } catch (error) {
    console.error('Error generating Excel:', error);
    throw new Error(
      error instanceof Error
        ? `Error al generar Excel: ${error.message}`
        : 'Error desconocido al generar Excel'
    );
  }
}

/**
 * Generate an Excel file with multiple sheets
 *
 * @param sheets - Array of sheet configurations
 * @param filename - Output filename (without extension)
 * @param includeDate - Whether to include generation date
 */
export async function generateMultiSheetExcel(
  sheets: ExcelSheetConfig[],
  filename: string,
  includeDate: boolean = true
): Promise<void> {
  try {
    const ExcelJS = await loadExcelJS();

    if (sheets.length === 0) {
      throw new Error('No hay hojas para exportar');
    }

    const workbook = new ExcelJS.Workbook();

    sheets.forEach((sheetConfig) => {
      const { name, data, headers } = sheetConfig;

      if (data.length === 0) {
        console.warn(`La hoja "${name}" no tiene datos`);
        return;
      }

      const rows: ExcelRow[] = [
        ...(includeDate ? buildDateRows(Object.keys(data[0])[0]) : []),
        ...data,
      ];

      addSheet(workbook, name, rows, {
        headers,
        includeHeaders: true,
        widths: calculateColumnWidths(data),
      });
    });

    await downloadWorkbook(workbook, filename);
  } catch (error) {
    console.error('Error generating multi-sheet Excel:', error);
    throw new Error(
      error instanceof Error
        ? `Error al generar Excel: ${error.message}`
        : 'Error desconocido al generar Excel'
    );
  }
}

/**
 * Calculate optimal column widths based on data content
 *
 * @param data - Array of data objects
 * @returns Array of column widths
 */
function calculateColumnWidths<
  T extends Record<string, string | number | boolean | null>
>(data: T[]): number[] {
  if (data.length === 0) return [];

  const keys = Object.keys(data[0]);
  const widths: number[] = [];

  keys.forEach((key) => {
    // Start with header width
    let maxWidth = key.length;

    // Check each row for this column
    data.forEach((row) => {
      const value = row[key];
      const valueStr = value !== null ? String(value) : '';
      maxWidth = Math.max(maxWidth, valueStr.length);
    });

    // Add padding and set max width
    widths.push(Math.min(maxWidth + 2, 50));
  });

  return widths;
}

/**
 * Convert table data to Excel-friendly format
 *
 * @param tableData - Array of objects with mixed types
 * @returns Array of objects with Excel-safe values
 */
export function prepareDataForExcel<T extends Record<string, unknown>>(
  tableData: T[]
): Array<Record<string, string | number | boolean | null>> {
  return tableData.map((row) => {
    const excelRow: Record<string, string | number | boolean | null> = {};

    Object.entries(row).forEach(([key, value]) => {
      // Handle different value types
      if (value === null || value === undefined) {
        excelRow[key] = null;
      } else if (typeof value === 'boolean') {
        excelRow[key] = value;
      } else if (typeof value === 'number') {
        excelRow[key] = value;
      } else if (typeof value === 'string') {
        excelRow[key] = value;
      } else if (value instanceof Date) {
        excelRow[key] = value.toLocaleDateString('es-ES');
      } else if (typeof value === 'object') {
        // Stringify objects
        excelRow[key] = JSON.stringify(value);
      } else {
        // Fallback to string conversion
        excelRow[key] = String(value);
      }
    });

    return excelRow;
  });
}

/**
 * Check if Excel generation is supported in the current environment
 *
 * @returns true if Excel generation is supported
 */
export function isExcelSupported(): boolean {
  return typeof window !== 'undefined';
}

/**
 * Format numbers for Excel export (ensure proper number type)
 *
 * @param value - Value to format
 * @param decimals - Number of decimal places
 * @returns Formatted number or null
 */
export function formatNumberForExcel(
  value: unknown,
  decimals: number = 2
): number | null {
  if (value === null || value === undefined) return null;

  const num = Number(value);
  if (isNaN(num)) return null;

  return Number(num.toFixed(decimals));
}

/**
 * Format currency for Excel export
 *
 * @param value - Value to format
 * @returns Formatted number or null
 */
export function formatCurrencyForExcel(value: unknown): number | null {
  return formatNumberForExcel(value, 2);
}

/**
 * Format date for Excel export
 *
 * @param date - Date to format
 * @param includeTime - Whether to include time
 * @returns Formatted date string
 */
export function formatDateForExcel(
  date: unknown,
  includeTime: boolean = false
): string | null {
  if (!date) return null;

  try {
    const dateObj = date instanceof Date ? date : new Date(String(date));

    if (isNaN(dateObj.getTime())) return null;

    if (includeTime) {
      return dateObj.toLocaleString('es-ES', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    }

    return dateObj.toLocaleDateString('es-ES', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return null;
  }
}
