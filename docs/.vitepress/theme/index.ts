import { h } from 'vue'
import DefaultTheme from 'vitepress/theme'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'home-features-before': () => h('h2', { class: 'home-features-title' }, 'Популярные разделы'),
    }),
}
