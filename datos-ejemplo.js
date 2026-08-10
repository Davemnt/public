/**
 * Datos de Ejemplo para Aurea v2
 * 
 * Este script carga datos de muestra en la aplicación
 * Para usar: Abrir la consola del navegador (F12) y ejecutar: cargarDatosEjemplo()
 */

async function cargarDatosEjemplo() {
  console.log('🔄 Cargando datos de ejemplo...');
  
  try {
    // Verificar que el usuario esté autenticado
    if (!Auth.isAuthenticated()) {
      console.error('❌ Debes estar autenticado para cargar datos');
      return;
    }
    
    // 1. Crear presupuestos de ejemplo
    const presupuesto1 = await DB.add('budgets', {
      budgetNumber: '260804001',
      number: '260804001',
      client: 'Constructora Del Sur S.A.',
      projectName: 'Edificio Residencial "Las Palmeras"',
      date: '2026-08-01',
      currency: 'ARG',
      items: [
        {
          id: '1',
          description: 'Diseño arquitectónico completo',
          quantity: 1,
          unitPrice: 2500000,
          total: 2500000
        },
        {
          id: '2',
          description: 'Planos estructurales',
          qty: 15,
          unitPrice: 80000,
          total: 1200000
        },
        {
          id: '3',
          description: 'Modelado 3D y renders',
          qty: 8,
          unitPrice: 150000,
          total: 1200000
        }
      ],
      subtotal: 4900000,
      tax: 1029000,
      total: 5929000,
      notes: 'Plazo de entrega: 45 días hábiles. Incluye 3 revisiones sin costo adicional.',
      status: 'aprobado-total',
      createdAt: new Date('2026-08-01')
    });
    
    const presupuesto2 = await DB.add('budgets', {
      budgetNumber: '260804002',
      number: '260804002',
      client: 'Hotel Boutique Lima',
      projectName: 'Remodelación de Lobby y Restaurante',
      date: '2026-08-02',
      currency: 'PERU',
      items: [
        {
          id: '1',
          description: 'Diseño de interiores - Lobby',
          qty: 1,
          unitPrice: 15000,
          total: 15000
        },
        {
          id: '2',
          description: 'Diseño de interiores - Restaurante',
          qty: 1,
          unitPrice: 18000,
          total: 18000
        },
        {
          id: '3',
          description: 'Selección de mobiliario',
          qty: 1,
          unitPrice: 5000,
          total: 5000
        }
      ],
      subtotal: 38000,
      tax: 6840,
      total: 44840,
      notes: 'Incluye visita a sitio y coordinación con proveedores.',
      status: 'pending',
      createdAt: new Date('2026-08-02')
    });
    
    const presupuesto3 = await DB.add('budgets', {
      budgetNumber: '260804003',
      number: '260804003',
      client: 'Tech Solutions USA',
      projectName: 'Oficinas Corporativas - Silicon Valley',
      date: '2026-08-03',
      currency: 'USA',
      items: [
        {
          id: '1',
          description: 'Diseño conceptual de oficinas',
          qty: 1,
          unitPrice: 25000,
          total: 25000
        },
        {
          id: '2',
          description: 'Espacios colaborativos y salas de reunión',
          qty: 8,
          unitPrice: 3500,
          total: 28000
        },
        {
          id: '3',
          description: 'Renders fotorrealistas 4K',
          qty: 12,
          unitPrice: 800,
          total: 9600
        }
      ],
      subtotal: 62600,
      tax: 6260,
      total: 68860,
      notes: 'Proyecto eco-friendly con certificación LEED. Plazo: 60 días.',
      status: 'draft',
      createdAt: new Date('2026-08-03')
    });
    
    console.log('✅ Presupuestos creados');
    
    // 2. Convertir presupuesto aprobado en proyecto
    const nextProjectNum = await DB.nextNumber('projectCounter');
    const proyecto1 = await DB.add('projects', {
      projectNumber: `PRY-${String(nextProjectNum).padStart(4, '0')}`,
      name: 'Edificio Residencial "Las Palmeras"',
      client: 'Constructora Del Sur S.A.',
      status: 'activo',
      administration: 'ARG',
      budget: 5929000,
      date: '2026-08-05',
      startDate: '2026-08-05',
      endDate: '2026-09-20',
      budgetId: presupuesto1.id,
      description: 'Proyecto de diseño completo para edificio residencial de 12 pisos con amenities.',
      createdAt: new Date('2026-08-05')
    });
    
    console.log('✅ Proyecto creado');
    
    // 3. Agregar ingresos (en colección 'incomes')
    await DB.add('incomes', {
      projectId: proyecto1.id,
      date: '2026-08-05',
      amount: 1778700,
      description: 'Anticipo 30% - Firma de contrato',
      paymentMethod: 'Transferencia bancaria',
      invoiceNumber: 'FAC-001-2026',
      createdAt: new Date('2026-08-05')
    });
    
    await DB.add('incomes', {
      projectId: proyecto1.id,
      date: '2026-08-15',
      amount: 1185800,
      description: 'Segundo pago 20% - Entrega de planos preliminares',
      paymentMethod: 'Transferencia bancaria',
      invoiceNumber: 'FAC-002-2026',
      createdAt: new Date('2026-08-15')
    });
    
    // Ingreso adicional para agosto (mes actual)
    await DB.add('incomes', {
      projectId: proyecto1.id,
      date: '2026-08-04',
      amount: 2000000,
      description: 'Anticipo',
      paymentMethod: 'Transferencia bancaria',
      createdAt: new Date('2026-08-04')
    });
    
    console.log('✅ Ingresos agregados');
    
    // 4. Agregar gastos (en colección 'expenses')
    await DB.add('expenses', {
      projectId: proyecto1.id,
      date: '2026-08-06',
      amount: 350000,
      description: 'Software de modelado 3D - Licencia anual',
      category: 'Software',
      supplier: 'Autodesk Argentina',
      createdAt: new Date('2026-08-06')
    });
    
    await DB.add('expenses', {
      projectId: proyecto1.id,
      date: '2026-08-08',
      amount: 180000,
      description: 'Consultoría estructural',
      category: 'Subcontratación',
      supplier: 'Ingeniería Total',
      createdAt: new Date('2026-08-08')
    });
    
    await DB.add('expenses', {
      projectId: proyecto1.id,
      date: '2026-08-10',
      amount: 45000,
      description: 'Viáticos - Visita a obra',
      category: 'Viajes',
      supplier: 'N/A',
      createdAt: new Date('2026-08-10')
    });
    
    console.log('✅ Gastos agregados');
    
    // 5. Agregar datos históricos para la gráfica (como operaciones de ingresos)
    // Ingresos de meses anteriores para mostrar en la gráfica del dashboard
    const mesesAtras = [
      { mes: '2026-07', ARG: 1200000, PERU: 8500, USA: 15000 },
      { mes: '2026-06', ARG: 950000, PERU: 12000, USA: 22000 },
      { mes: '2026-05', ARG: 1800000, PERU: 15500, USA: 18000 },
      { mes: '2026-04', ARG: 750000, PERU: 9000, USA: 12000 },
      { mes: '2026-03', ARG: 1500000, PERU: 18000, USA: 25000 },
      { mes: '2026-02', ARG: 890000, PERU: 7500, USA: 16000 },
    ];
    
    for (const dato of mesesAtras) {
      // Ingreso Argentina
      if (dato.ARG > 0) {
        await DB.add('operations', {
          tipo: 'ingreso',
          administration: 'ARG',
          date: `${dato.mes}-15`,
          monto: dato.ARG,
          description: `Ingreso del mes ${dato.mes}`,
          createdAt: new Date(`${dato.mes}-15`)
        });
      }
      
      // Ingreso Perú
      if (dato.PERU > 0) {
        await DB.add('operations', {
          tipo: 'ingreso',
          administration: 'PERU',
          date: `${dato.mes}-15`,
          monto: dato.PERU,
          description: `Ingreso del mes ${dato.mes}`,
          createdAt: new Date(`${dato.mes}-15`)
        });
      }
      
      // Ingreso USA
      if (dato.USA > 0) {
        await DB.add('operations', {
          tipo: 'ingreso',
          administration: 'USA',
          date: `${dato.mes}-15`,
          monto: dato.USA,
          description: `Ingreso del mes ${dato.mes}`,
          createdAt: new Date(`${dato.mes}-15`)
        });
      }
    }
    
    console.log('✅ Datos históricos agregados para la gráfica');
    
    // 6. Agregar tareas del proyecto (operations SIN tipo, sólo con type de tarea)
    await DB.add('operations', {
      projectId: proyecto1.id,
      date: '2026-08-05',
      type: 'milestone',
      description: 'Reunión inicial con cliente - Definición de alcance',
      status: 'completed',
      responsible: 'Arq. Juan Pérez',
      createdAt: new Date('2026-08-05')
    });
    
    await DB.add('operations', {
      projectId: proyecto1.id,
      date: '2026-08-12',
      type: 'task',
      description: 'Desarrollo de plantas arquitectónicas - Pisos 1-6',
      status: 'in-progress',
      responsible: 'Arq. María González',
      createdAt: new Date('2026-08-12')
    });
    
    await DB.add('operations', {
      projectId: proyecto1.id,
      date: '2026-08-18',
      type: 'review',
      description: 'Revisión con comité técnico del cliente',
      status: 'pending',
      responsible: 'Arq. Juan Pérez',
      createdAt: new Date('2026-08-12')
    });
    
    console.log('✅ Tareas del proyecto agregadas');
    
    // 7. Crear una factura
    const nextInvoiceNum = await DB.nextNumber('invoiceCounter');
    await DB.add('invoices', {
      invoiceNumber: `FAC-001-2026`,
      projectId: proyecto1.id,
      client: 'Constructora Del Sur S.A.',
      date: '2026-08-05',
      dueDate: '2026-08-20',
      currency: 'ARG',
      items: [
        {
          description: 'Anticipo 30% - Diseño arquitectónico',
          quantity: 1,
          unitPrice: 1778700,
          total: 1778700
        }
      ],
      subtotal: 1778700,
      tax: 0,
      total: 1778700,
      status: 'paid',
      paidDate: '2026-08-05',
      notes: 'Pago recibido por transferencia bancaria.',
      createdAt: new Date('2026-08-05')
    });
    
    console.log('✅ Factura creada');
    
    // 8. Configurar datos de la empresa (si no existen)
    const config = DB.getConfig();
    if (!config || !config.company || !config.company.name) {
      const currentConfig = config || {};
      currentConfig.company = {
        name: 'Aurea Arquitectura & Diseño',
        address: 'Av. Libertador 1234, Piso 8, CABA, Argentina',
        email: 'contacto@aurea-arquitectura.com',
        phone: '+54 11 4567-8900',
        taxId: 'CUIT: 30-12345678-9',
        logo: ''
      };
      await DB.setConfig(currentConfig);
      console.log('✅ Configuración de empresa creada');
    }
    
    console.log('');
    console.log('🎉 ¡Datos de ejemplo cargados exitosamente!');
    console.log('');
    console.log('📊 Resumen:');
    console.log('   - 3 Presupuestos (1 aprobado, 1 pendiente, 1 borrador)');
    console.log('   - 1 Proyecto activo');
    console.log('   - 2 Ingresos del proyecto actual');
    console.log('   - 3 Gastos del proyecto');
    console.log('   - 3 Tareas del proyecto');
    console.log('   - 1 Factura emitida y pagada');
    console.log('   - Datos históricos de 6 meses para la gráfica');
    console.log('');
    console.log('   - 1 Factura emitida');
    console.log('');
    console.log('💡 Recarga la página para ver los datos en la aplicación');
    
    // Recargar la página después de 2 segundos solo si no hay función de notificación
    if (typeof notify !== 'function') {
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } else {
      // Si estamos en la app, mostrar notificación y navegar al dashboard
      notify('¡Datos de ejemplo cargados exitosamente! 🎉');
      setTimeout(() => {
        if (typeof navigate === 'function') {
          navigate('#/');
        } else {
          window.location.reload();
        }
      }, 1000);
    }
    
  } catch (error) {
    console.error('❌ Error cargando datos de ejemplo:', error);
    throw error; // Re-lanzar el error para que la UI pueda manejarlo
  }
}

// Hacer la función disponible globalmente
window.cargarDatosEjemplo = cargarDatosEjemplo;

console.log('');
console.log('📦 Datos de ejemplo disponibles');
console.log('💡 Para cargar datos de muestra, ejecuta en la consola:');
console.log('   cargarDatosEjemplo()');
console.log('');
