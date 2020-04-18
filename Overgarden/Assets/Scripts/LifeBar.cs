using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class LifeBar : MonoBehaviour
{   
    public GameObject player;
    Vector3 diff;
    int aux = 0;
    public Slider slider;
    public int maxLife = 100;

    public GameObject bar;

    private void Start()
    {
        slider.minValue = 0;
        slider.maxValue = maxLife;
        slider.value = maxLife;
    }

    private void Update()
    {
        if(slider.value >= slider.maxValue)
        {
            slider.value = maxLife;
        }
        if(slider.value <= slider.minValue)
        {
            slider.value = slider.minValue;
        }

        damage();

        diff = transform.position - player.transform.position;

        waterThePlants();

    }
    public void damage()
    {
        if(aux%10 == 0)
        {
            slider.value--;
        }
        aux++;
        if(aux == 1000)
        {
            aux = 0;
        }
        if(slider.value == slider.minValue)
        {
            Destroy(gameObject);
        }
    }  

    public void waterThePlants()
    {
        if(diff.magnitude < 1 && Input.GetKeyDown(KeyCode.F))
        {
            slider.value = slider.maxValue;
        }
    } 
}
