# Public-information request: authorized terraces in Badajoz

Ready-to-file request under Ley 19/2013 (the Spanish transparency law) for the Ayuntamiento's register of terrace (velador) authorizations. The notes are in English; the letter itself is in Spanish on purpose (see [Request text](#request-text-in-spanish)). Context: [ADR-0002](../adr/0002-terrace-data-sources.md), [research notes](data-sources.md).

## How to file (the user does this)

- **Where**: the council's online office, the [sede electrónica](https://sede.aytobadajoz.es). It has no specific access-to-information procedure, so use the generic application form, **Solicitud Genérica**, signed with Cl@ve or a digital certificate, addressed to the **Oficina Auxiliar de Vías y Obras** (it handles velador licences: viasyobras@aytobadajoz.es, 924 21 00 10). Alternatively, file in person at the council's main registry, the Registro General.
- **Fill in** the `[…]` fields: full name, DNI/NIE, postal address, email and date. Leave everything else as it is: every item asks for data the ordinance already requires in each authorization (art. 28.3), so the answer should not count as *reelaboración*, i.e. having to create new information, which is a ground for refusal (CTBG [Criterio Interpretativo 4/2026](https://consejodetransparencia.es/content/dam/ctransparencia/portal-ctbg/publicaciones/criterios-interpretativos/2026/4_CI-18-1-c_Reelaboracion.pdf), §4.3.c: a direct extraction from a database is not reelaboración).
- **Deadline**: one month from receipt, extendable by one more (art. 20.1). No answer by then means refusal (art. 20.4).
- **If refused or unanswered**: complain to the Consejo de Transparencia y Buen Gobierno within one month (art. 24). Quote [RA CTBG 2023-0153](https://web.archive.org/web/20230421031929/https://www.consejodetransparencia.es/ct_Home/dam/jcr:124cf368-4059-41c7-93c6-f8d232a12bc3/RA%20CTBG%202023-0153%20%5BExpediente%20914-2023%5D_Censurado.pdf) (access to a Badajoz velador file upheld) and [RA CTBG 2024-0298](https://web.archive.org/web/20240516025109/https://www.consejodetransparencia.es/ct_Home/dam/jcr:70f1ad4f-9861-437c-b754-6e7f2c37e66c/RA%20CTBG%202024-0298%20%5BExpediente%202382_2023%5D_Censurado.pdf) (access to Badajoz activity licences upheld). **Expect silence**: in both cases Badajoz answered neither the requester nor the CTBG, so set a reminder to complain on day 31.
- **Known gap**: terraces on the venue's own private plot (patios, gardens, rooftops) fall under the activity licence, not the velador licence (2024 acoustic ordinance), so this list will miss them.
- **Once it arrives**: keep the original out of the repo. Record the file date and reuse conditions in the research notes, and seed the curated CSV from it (ADR-0002).

## Request text (in Spanish)

The letter is intentionally in Spanish: it must be filed in Spanish, so do not translate it. In short, it asks for:

1. The list of current terrace authorizations, one row each: business name, venue address, authorized space (street, nearest building number, type of space), area in m², number of tables, chairs and umbrellas, whether it has a fixed enclosure, and grant or renewal date with file number.
2. The GIS layer of authorized terraces and the occupancy plans, if they exist in digital form.
3. The reuse conditions under Ley 37/2007.

It asks for electronic delivery as CSV or XLSX, rules out personal and tax data, and states the purpose: an open, non-profit sun and shade map.

> **AL EXCMO. AYUNTAMIENTO DE BADAJOZ**
>
> A la atención de la unidad responsable del acceso a la información pública y del servicio que tramita las autorizaciones de terrazas de veladores.
>
> **Solicitante**
>
> - Nombre y apellidos: [NOMBRE Y APELLIDOS]
> - DNI/NIE: [DNI]
> - Domicilio a efectos de notificaciones: [DIRECCIÓN POSTAL]
> - Correo electrónico (medio preferente de notificación): [EMAIL]
>
> **EXPONE**
>
> Que, al amparo del artículo 105.b) de la Constitución, de los artículos 12, 13 y 17 de la Ley 19/2013, de 9 de diciembre, de transparencia, acceso a la información pública y buen gobierno, y de la Ley 4/2013, de 21 de mayo, de Gobierno Abierto de Extremadura, ejerce su derecho de acceso a la información pública.
>
> Que la Ordenanza reguladora de la instalación de veladores en el término municipal de Badajoz exige que cada resolución de autorización recoja, entre otros datos, la localización del espacio autorizado (vía y número del edificio más próximo), la superficie en metros cuadrados y el número de mesas, sillas y sombrillas (art. 28.3). Por tanto, la información solicitada ya obra en poder del Ayuntamiento.
>
> **SOLICITA**
>
> 1. **Relación de las autorizaciones de terrazas de veladores vigentes** en el término municipal (en 2026, o a la fecha en que se atienda la solicitud), con una fila por autorización y, para cada una:
>    1. nombre comercial o rótulo del establecimiento y, si el titular es persona jurídica, su razón social;
>    2. dirección del establecimiento al que sirve la terraza;
>    3. ubicación del espacio autorizado: vía, número del edificio más próximo y tipo de espacio (acera, calzada, plaza, espacio libre privado de uso público…);
>    4. superficie autorizada en metros cuadrados;
>    5. número de mesas, sillas o sillones y sombrillas autorizados;
>    6. si la instalación tiene cerramiento estable y permanente;
>    7. fecha de concesión o de la última renovación, y referencia o número de expediente.
> 2. Si el Ayuntamiento dispone de ella, **copia de la capa georreferenciada** (SIG) de las terrazas autorizadas, en cualquier formato estándar (GeoJSON, Shapefile, KML, GeoPackage o CSV con coordenadas), y, cuando existan en formato digital, los **planos de ocupación** que acompañan a cada autorización (como publica el Ayuntamiento de Málaga en su portal de datos abiertos).
> 3. Las **condiciones de reutilización** aplicables a la información facilitada, conforme a la Ley 37/2007, de 16 de noviembre, sobre reutilización de la información del sector público.
>
> **Formato**: se solicita la entrega por vía electrónica (art. 22.1 de la Ley 19/2013) en un formato reutilizable (CSV o XLSX), tal como se pueda exportar de las aplicaciones de gestión municipales. No se pide que se elabore ningún documento nuevo. Según el Criterio Interpretativo 4/2026, de 17 de junio, del Consejo de Transparencia y Buen Gobierno (apartado 4.3.c), extraer directamente la información de las bases de datos o aplicaciones informáticas que gestiona el órgano requerido no es reelaboración.
>
> **Datos personales**: no se solicitan datos de personas físicas. Si el titular de alguna autorización es persona física, basta con el nombre comercial del establecimiento, omitiendo su nombre y NIF (art. 15 de la Ley 19/2013). Tampoco se solicitan datos tributarios (padrón o liquidaciones de la tasa).
>
> **Finalidad** (no es obligatorio indicarla, art. 17.3): elaborar un mapa abierto y sin ánimo de lucro que muestra qué terrazas de Badajoz tienen sol o sombra a cada hora. Los datos resultantes se publicarán con licencia abierta, citando al Ayuntamiento de Badajoz como fuente. Asimismo, se sugiere al Ayuntamiento que publique esta relación en formato abierto, como ya hacen Madrid, Barcelona, Málaga o Zaragoza.
>
> En Badajoz, a [FECHA].
>
> Firmado: [NOMBRE Y APELLIDOS]
