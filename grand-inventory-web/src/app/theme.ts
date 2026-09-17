/**
 * PrimeNG's palette, pointed at the console's own.
 *
 * Driving the preset is the alternative to overriding PrimeNG component by
 * component in the stylesheet. A button, a drawer header and an input border
 * all resolve from the same two ramps, so there is one place to change the
 * look and no chance of a component that missed the memo.
 */
import { definePreset } from '@primeng/themes';
import Aura from '@primeng/themes/aura';

/** Brass - the weights on the scale. The only accent the console uses. */
const brass = {
    50: '#fbf7f0',
    100: '#f6efe2',
    200: '#e7cfa7',
    300: '#d8b278',
    400: '#c79852',
    500: '#b08039',
    600: '#97682d',
    700: '#7a5326',
    800: '#5e4020',
    900: '#46301a',
    950: '#2a1c0e'
};

/** Cold store - steel shelving and the walk-in. */
const steel = {
    0: '#ffffff',
    50: '#f6f8f7',
    100: '#f1f3f2',
    200: '#dce2e0',
    300: '#c3cbc9',
    400: '#97a3a1',
    500: '#6e7c7a',
    600: '#55625f',
    700: '#414d4a',
    800: '#2a3437',
    900: '#172026',
    950: '#0f1518'
};

export const GrandPreset = definePreset(Aura, {
    primitive: { brass, steel },
    semantic: {
        primary: brass,
        borderRadius: {
            none: '0',
            xs: '2px',
            sm: '3px',
            md: '4px',
            lg: '6px',
            xl: '8px'
        },
        colorScheme: {
            light: {
                surface: steel,
                primary: {
                    color: '{brass.600}',
                    contrastColor: '#ffffff',
                    hoverColor: '{brass.700}',
                    activeColor: '{brass.800}'
                },
                formField: {
                    background: '#ffffff',
                    borderColor: '{steel.200}',
                    hoverBorderColor: '{steel.300}',
                    focusBorderColor: '{brass.500}',
                    color: '{steel.950}',
                    placeholderColor: '{steel.400}'
                },
                content: { borderColor: '{steel.200}' }
            },
            dark: {
                surface: steel,
                primary: {
                    color: '{brass.300}',
                    contrastColor: '{steel.950}',
                    hoverColor: '{brass.200}',
                    activeColor: '{brass.100}'
                },
                formField: {
                    background: '{steel.900}',
                    borderColor: '{steel.800}',
                    hoverBorderColor: '{steel.700}',
                    focusBorderColor: '{brass.300}',
                    color: '{steel.50}',
                    placeholderColor: '{steel.500}'
                },
                content: { borderColor: '{steel.800}' }
            }
        }
    }
});
