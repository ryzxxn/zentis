import type { UIComponentDefinition } from './types.js';

/**
 * ZentisUI Registry
 * Manages UI component definitions and generates instructions for the LLM.
 */
export class ZentisUI {
  private components: Map<string, UIComponentDefinition> = new Map();

  constructor() {
    // Register default generalized components
    this.register({
      name: 'Table',
      description: 'Render a data table. Optimized for large datasets.',
      props: {
        title: { type: 'string', description: 'The table title', required: false },
        columns: { type: 'array', description: 'List of column keys to display. If omitted, all keys are shown.', required: false },
        data: { type: 'data_reference', description: 'The data reference ID (e.g. res_1_tool_name)', required: true },
        filters: { type: 'object', description: 'Key-value pairs or conditions to filter the data (e.g. {"name": "Jordan"}).', required: false }
      }
    });

    this.register({
      name: 'Chart',
      description: 'Render a visual chart (bar, line, pie).',
      props: {
        type: { type: 'string', description: 'Type of chart: bar, line, pie, area', required: true },
        xAxis: { type: 'string', description: 'Key for the x-axis', required: true },
        yAxis: { type: 'string', description: 'Key for the y-axis', required: true },
        data: { type: 'data_reference', description: 'The data reference ID', required: true },
        filters: { type: 'object', description: 'Filter conditions to apply before charting.', required: false }
      }
    });

    this.register({
      name: 'Graph',
      description: 'Render a network or relationship graph.',
      props: {
        nodes: { type: 'data_reference', description: 'Reference to nodes list', required: true },
        edges: { type: 'data_reference', description: 'Reference to edges list', required: true },
        layout: { type: 'string', description: 'Layout type: force, circular, grid', required: false }
      }
    });
  }

  /**
   * Register a new UI component definition
   */
  public register(definition: UIComponentDefinition): void {
    this.components.set(definition.name, definition);
  }

  /**
   * Generate the system prompt instructions for the LLM to use these components
   */
  public generateInstructions(): string {
    if (this.components.size === 0) return "";

    let instructions = "VISUAL COMPONENTS:\n";
    instructions += "You can trigger UI components in your response using the format: [UI:ComponentName]{\"prop\": \"val\"}[/UI]\n";
    
    for (const comp of this.components.values()) {
      instructions += `- ${comp.name}: ${comp.description}\n`;
      instructions += `  Props: ${JSON.stringify(comp.props)}\n`;
    }
    
    instructions += "\nCRITICAL: When using 'data_reference' types, provide the result ID (e.g., \"res_1_fetch_logs\") exactly as shown in the [DATA_REFERENCE] notice.\n";
    
    return instructions;
  }

  public getDefinitions(): UIComponentDefinition[] {
    return Array.from(this.components.values());
  }
}
